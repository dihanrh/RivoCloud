import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service.js';
import { ApiKeysService } from '../api-keys/api-keys.service.js';

export interface CombinedAuthContext {
  type: 'jwt' | 'api_key';
  userId: string | null;
  orgId: string | null;
  role: string | null;
  apiKeyId?: string;
  permissions?: string[];
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    const authHeader = request.headers['authorization'] as string | undefined;

    if (apiKeyHeader?.startsWith('rc_')) {
      const key = await this.apiKeys.verifyRawKey(apiKeyHeader);
      if (!key) {
        throw new UnauthorizedException('Invalid API key');
      }
      const auth: CombinedAuthContext = {
        type: 'api_key',
        userId: key.userId,
        orgId: key.orgId,
        role: null,
        apiKeyId: key.id,
        permissions: key.permissions as string[],
      };
      request.auth = auth;
      return true;
    }

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization bearer token or X-API-Key header');
    }
    const token = authHeader.slice('Bearer '.length);
    let claims;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (await this.tokens.isAccessTokenBlacklisted(claims.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    const auth: CombinedAuthContext = { type: 'jwt', userId: claims.sub, orgId: claims.org, role: claims.role };
    request.auth = auth;
    return true;
  }
}
