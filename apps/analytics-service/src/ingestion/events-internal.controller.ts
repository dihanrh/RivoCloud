import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard.js';
import { RequestLogWriter } from './request-log-writer.js';
import { IngestBatchDto } from './events-internal.dto.js';

@Controller('internal/analytics')
@UseGuards(InternalAuthGuard)
export class EventsInternalController {
  constructor(private readonly writer: RequestLogWriter) {}

  @Post('events')
  async ingest(@Body() dto: IngestBatchDto) {
    await this.writer.insertBatch(dto.events);
    return { ingested: dto.events.length };
  }
}
