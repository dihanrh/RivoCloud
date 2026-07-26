import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service.js';

@Injectable()
export class JwtOnlyGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

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
    request.auth = { userId: claims.sub, orgId: claims.org, role: claims.role };
    return true;
  }
}
