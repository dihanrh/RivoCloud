import { Global, Module } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const MINIO = 'MINIO';

@Global()
@Module({
  providers: [
    {
      provide: MINIO,
      useFactory: (env: AppEnv) => {
        const url = new URL(env.MINIO_URL);
        return new MinioClient({
          endPoint: url.hostname,
          port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
          useSSL: url.protocol === 'https:',
          accessKey: env.MINIO_ROOT_USER,
          secretKey: env.MINIO_ROOT_PASSWORD,
        });
      },
      inject: [APP_ENV],
    },
  ],
  exports: [MINIO],
})
export class MinioModule {}
