import { Global, Module } from '@nestjs/common';
import { RequestLogWriter } from './request-log-writer.js';
import { IngestionService } from './ingestion.service.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Global()
@Module({
  providers: [
    RequestLogWriter,
    {
      provide: IngestionService,
      useFactory: (env: AppEnv, writer: RequestLogWriter) => new IngestionService(env.NATS_URL, writer),
      inject: [APP_ENV, RequestLogWriter],
    },
  ],
  exports: [IngestionService, RequestLogWriter],
})
export class IngestionModule {}
