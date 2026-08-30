import { Inject, Injectable } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { CLICKHOUSE } from '../clickhouse/clickhouse.token.js';
import type { EdgeRequestEvent } from './edge-request-event.js';

@Injectable()
export class RequestLogWriter {
  constructor(@Inject(CLICKHOUSE) private readonly client: ClickHouseClient) {}

  async insertBatch(events: EdgeRequestEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.client.insert({
      table: 'request_logs',
      values: events,
      format: 'JSONEachRow',
      // The Edge Proxy marshals `timestamp` as Go's time.Time default JSON
      // format (RFC3339, e.g. "2026-06-29T10:00:00.000Z"). ClickHouse's
      // default JSONEachRow DateTime64 parser rejects the "T"/"Z" separators
      // ("Cannot parse input: expected '"' before: 'Z...'"); best_effort
      // parsing accepts RFC3339 alongside the native "YYYY-MM-DD HH:MM:SS" form.
      clickhouse_settings: { date_time_input_format: 'best_effort' },
    });
  }
}
