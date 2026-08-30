import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const REDIS = 'REDIS';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (env: AppEnv) => new Redis(env.REDIS_URL),
      inject: [APP_ENV],
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
