import { Body, Controller, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { NoAudit } from '@rivocloud/security';
import { InternalSecretGuard } from './internal-secret.guard.js';
import { TokenService } from '../auth/token.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';
import { MembershipService } from '../organizations/membership.service.js';

class VerifyTokenDto {
  @IsString()
  token!: string;
}

class VerifyApiKeyDto {
  @IsString()
  apiKey!: string;
}

// Service-to-service verification calls are reads in effect; nothing to audit.
@NoAudit()
@Controller('internal/auth')
@UseGuards(InternalSecretGuard)
export class InternalController {
  constructor(
    private readonly tokens: TokenService,
    private readonly apiKeys: ApiKeysService,
    private readonly membership: MembershipService,
  ) {}

  @Post('verify-token')
  async verifyToken(@Body() dto: VerifyTokenDto) {
    let claims;
    try {
      claims = await this.tokens.verifyAccessToken(dto.token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (await this.tokens.isAccessTokenBlacklisted(claims.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    // The role claim can be stale for up to the access-token TTL; return the live role.
    const role = await this.membership.roleForTokenClaims(claims.org, claims.sub);
    return { userId: claims.sub, orgId: claims.org, role };
  }

  @Post('verify-api-key')
  async verifyApiKey(@Body() dto: VerifyApiKeyDto) {
    const key = await this.apiKeys.verifyRawKey(dto.apiKey);
    if (!key) {
      throw new UnauthorizedException('Invalid API key');
    }
    return { orgId: key.orgId, userId: key.userId, apiKeyId: key.id, permissions: key.permissions };
  }
}
