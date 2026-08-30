import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { CLICKHOUSE } from '../clickhouse/clickhouse.token.js';

@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(@Inject(CLICKHOUSE) private readonly ch: ClickHouseClient) {}

  // Rolls up the full hour immediately before `now` — e.g. run at 14:03, it
  // rolls up [13:00, 14:00). ClickHouse's own INSERT INTO ... SELECT does
  // the aggregation server-side; SummingMergeTree merges same-key rows in
  // the background, so a re-run for the same hour is safe (this plan's
  // Design Decision 6).
  async rollupBandwidthForPreviousHour(now: Date = new Date()): Promise<void> {
    const hourStart = new Date(now);
    hourStart.setUTCMinutes(0, 0, 0);
    hourStart.setUTCHours(hourStart.getUTCHours() - 1);
    const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

    await this.ch.command({
      query: `
        INSERT INTO bandwidth_hourly (hour, zone_id, org_id, bytes_sent, requests, cache_hits, cache_misses)
        SELECT
          toStartOfHour(timestamp) AS hour,
          zone_id,
          org_id,
          sum(bytes_sent) AS bytes_sent,
          count() AS requests,
          countIf(cache_status = 'HIT') AS cache_hits,
          countIf(cache_status != 'HIT') AS cache_misses
        FROM request_logs
        WHERE timestamp >= {hourStart:DateTime64(3)} AND timestamp < {hourEnd:DateTime64(3)}
        GROUP BY hour, zone_id, org_id
      `,
      // Pass real `Date` objects (not `.toISOString()` strings) for these
      // DateTime64(3, 'UTC')-column parameters — see analytics.service.ts's
      // `range()` for why: `@clickhouse/client` serializes a `Date` value as
      // a timezone-agnostic Unix timestamp, whereas a formatted string is
      // parsed using the ClickHouse server's session default timezone.
      query_params: { hourStart, hourEnd },
    });
    this.logger.log(`rolled up bandwidth_hourly for ${hourStart.toISOString()}`);
  }

  async rollupCountryForPreviousDay(now: Date = new Date()): Promise<void> {
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    dayStart.setUTCDate(dayStart.getUTCDate() - 1);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    await this.ch.command({
      query: `
        INSERT INTO requests_by_country_daily (date, zone_id, country, requests, bytes_sent)
        SELECT
          toDate(timestamp) AS date,
          zone_id,
          country,
          count() AS requests,
          sum(bytes_sent) AS bytes_sent
        FROM request_logs
        WHERE timestamp >= {dayStart:DateTime64(3)} AND timestamp < {dayEnd:DateTime64(3)}
        GROUP BY date, zone_id, country
      `,
      // Same Date-object treatment as above — request_logs.timestamp is
      // also DateTime64(3, 'UTC').
      query_params: { dayStart, dayEnd },
    });
    this.logger.log(`rolled up requests_by_country_daily for ${dayStart.toISOString().slice(0, 10)}`);
  }
}
