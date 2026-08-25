import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityClient } from './identity-client.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly identity: IdentityClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    const authHeader = request.headers['authorization'] as string | undefined;

    if (apiKeyHeader?.startsWith('rc_')) {
      request.auth = await this.identity.verifyApiKey(apiKeyHeader);
      return true;
    }

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization bearer token or X-API-Key header');
    }
    request.auth = await this.identity.verifyToken(authHeader.slice('Bearer '.length));
    return true;
  }
}
