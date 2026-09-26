import { Controller, Get } from '@nestjs/common';
import { IngestionService } from '../ingestion/ingestion.service.js';

@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly ingestion: IngestionService) {}

  // `status` stays a plain liveness signal (the HTTP API itself is up); the
  // `ingestion` field makes a dead NATS -> ClickHouse pipeline visible instead
  // of hiding behind an unconditional "ok".
  @Get()
  check() {
    return { status: 'ok', ingestion: this.ingestion.health() };
  }
}
