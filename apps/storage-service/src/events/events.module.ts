import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Global()
@Module({
  providers: [
    {
      provide: EventsService,
      useFactory: (env: AppEnv) => new EventsService(env.NATS_URL),
      inject: [APP_ENV],
    },
  ],
  exports: [EventsService],
})
export class EventsModule {}
