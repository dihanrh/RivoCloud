import { Module } from '@nestjs/common';
import { EventsInternalController } from './events-internal.controller.js';
import { InternalAuthGuard } from './internal-auth.guard.js';

@Module({
  controllers: [EventsInternalController],
  providers: [InternalAuthGuard],
})
export class IngestionInternalModule {}
