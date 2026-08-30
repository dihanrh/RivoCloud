import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { CLICKHOUSE } from './clickhouse.token.js';
import { SCHEMA_STATEMENTS } from './schema.js';

@Injectable()
export class SchemaService implements OnModuleInit {
  private readonly logger = new Logger(SchemaService.name);

  constructor(@Inject(CLICKHOUSE) private readonly client: ClickHouseClient) {}

  async onModuleInit(): Promise<void> {
    for (const statement of SCHEMA_STATEMENTS) {
      await this.client.command({ query: statement });
    }
    this.logger.log('ClickHouse schema is up to date');
  }
}
