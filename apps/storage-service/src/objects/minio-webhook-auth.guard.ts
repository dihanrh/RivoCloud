import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Injectable()
export class MinioWebhookAuthGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] as string | undefined;
    if (authHeader !== `Bearer ${this.env.MINIO_WEBHOOK_AUTH_TOKEN}`) {
      throw new UnauthorizedException('Invalid or missing MinIO webhook token');
    }
    return true;
  }
}
