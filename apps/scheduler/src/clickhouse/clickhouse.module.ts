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
      useFactory: (env: AppEnv) =>
        createClient({
          url: env.CLICKHOUSE_URL,
          clickhouse_settings: {
            // JSON output formats quote 64-bit integers (every count()/sum()
            // over a UInt64 column, and toUnixTimestamp(...) * 1000 epoch-ms
            // buckets) as strings by default. Emitting them as plain JSON
            // numbers keeps every row this client reads honest to the
            // dashboard's `number`-typed contract (Recharts ignores
            // string-typed values outright). Tradeoff: JS numbers lose
            // precision above Number.MAX_SAFE_INTEGER (2^53 - 1, ~9e15) — far
            // beyond any realistic Phase-1 request or byte count, but a query
            // that could genuinely exceed it should cast to String itself.
            output_format_json_quote_64bit_integers: 0,
          },
        }),
      inject: [APP_ENV],
    },
    SchemaService,
  ],
  exports: [CLICKHOUSE],
})
export class ClickhouseModule {}
