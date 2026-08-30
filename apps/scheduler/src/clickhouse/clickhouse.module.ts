import { Global, Module } from '@nestjs/common';
import { createClient } from '@clickhouse/client';
import { CLICKHOUSE } from './clickhouse.token.js';
import { SchemaService } from './schema.service.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Global()
@Module({
  providers: [
    {
      provide: CLICKHOUSE,
      useFactory: (env: AppEnv) => createClient({ url: env.CLICKHOUSE_URL }),
      inject: [APP_ENV],
    },
    SchemaService,
  ],
  exports: [CLICKHOUSE],
})
export class ClickhouseModule {}
