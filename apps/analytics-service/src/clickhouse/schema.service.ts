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
      try {
        await this.client.command({ query: statement });
      } catch (error) {
        // Still fatal (re-thrown, failing the boot as before) — this only
        // makes it diagnosable: which statement failed and why, rather than
        // a bare DI bootstrap exception with no ClickHouse context.
        const firstLine = statement.trim().split(/\r?\n/)[0];
        this.logger.error(
          `failed to apply ClickHouse schema statement "${firstLine}": ${(error as Error).message}`,
          (error as Error).stack,
        );
        throw error;
      }
    }
    this.logger.log('ClickHouse schema is up to date');
  }
}
