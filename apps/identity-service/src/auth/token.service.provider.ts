import { Provider } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Redis } from 'ioredis';
import { TokenService } from './token.service.js';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const tokenServiceProvider: Provider = {
  provide: TokenService,
  useFactory: (redis: Redis, env: AppEnv) => {
    const privateKey = readFileSync(resolve(env.JWT_PRIVATE_KEY_PATH), 'utf-8');
    const publicKey = readFileSync(resolve(env.JWT_PUBLIC_KEY_PATH), 'utf-8');
    return new TokenService(redis, env, privateKey, publicKey);
  },
  inject: [REDIS, APP_ENV],
};
