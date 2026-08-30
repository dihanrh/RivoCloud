import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.headers['x-internal-secret'] as string | undefined;
    if (secret !== this.env.INTERNAL_API_SECRET) {
      throw new UnauthorizedException('Missing or invalid X-Internal-Secret header');
    }
    return true;
  }
}
