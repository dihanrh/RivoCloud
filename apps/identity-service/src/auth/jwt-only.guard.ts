import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service.js';
import { MembershipService } from '../organizations/membership.service.js';
import type { AuthContext } from './auth-context.decorator.js';

@Injectable()
export class JwtOnlyGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly membership: MembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    let claims;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (await this.tokens.isAccessTokenBlacklisted(claims.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    // The JWT's role claim may be stale (demotion/removal); read it live.
    const role = await this.membership.roleForTokenClaims(claims.org, claims.sub);
    const auth: AuthContext = { type: 'jwt', userId: claims.sub, orgId: claims.org, role };
    request.auth = auth;
    return true;
  }
}
