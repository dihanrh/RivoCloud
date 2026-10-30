import type { INestApplication } from '@nestjs/common';

/** Makes request.ip honour X-Forwarded-For only from trusted proxy hops. */
export function configureTrustProxy(app: INestApplication, value: string): void {
  app.getHttpAdapter().getInstance().set('trust proxy', value);
}
