import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';
import { RollupService } from './rollup.service.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Fixture timestamps are relative to now: request_logs has a 90-day TTL, so a
// hard-coded date eventually expires and ClickHouse drops the inserted rows.
/** `YYYY-MM-DD HH:MM:SS.mmm` in UTC, the DateTime64(3, 'UTC') text format. */
function chDateTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

describe('RollupService', () => {
  let app: INestApplication;
  let rollup: RollupService;
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rollup = app.get(RollupService);
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await ch.close();
    await app.close();
  });

  it('aggregates the previous hour of request_logs into bandwidth_hourly', async () => {
    const zoneId = `rollup-test-${Date.now()}`;
    // "now" is the start of the current UTC hour so "the previous hour" is a
    // known window: [now - 1h, now).
    const now = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);
    const hourStart = now.getTime() - HOUR_MS;
    await ch.insert({
      table: 'request_logs',
      values: [
        { timestamp: chDateTime(hourStart + 15 * 60 * 1000), zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/a', status_code: 200, cache_status: 'HIT', bytes_sent: 100, duration_ms: 5, country: 'DE', client_ip_hash: 'h1' },
        { timestamp: chDateTime(hourStart + 45 * 60 * 1000), zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/b', status_code: 200, cache_status: 'MISS', bytes_sent: 200, duration_ms: 8, country: 'DE', client_ip_hash: 'h2' },
      ],
      format: 'JSONEachRow',
    });

    await rollup.rollupBandwidthForPreviousHour(now);

    const resultSet = await ch.query({
      query: `
        SELECT toUnixTimestamp(hour) AS hour_epoch, bytes_sent, requests, cache_hits, cache_misses
        FROM bandwidth_hourly WHERE zone_id = {zoneId:String}
      `,
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ hour_epoch: number; bytes_sent: string; requests: string; cache_hits: string; cache_misses: string }>();
    expect(rows).toHaveLength(1);
    // bandwidth_hourly.hour is DateTime('UTC'): the stored bucket is exactly
    // the hour start regardless of the ClickHouse server's default timezone.
    expect(Number(rows[0].hour_epoch)).toBe(hourStart / 1000);
    expect(Number(rows[0].bytes_sent)).toBe(300);
    expect(Number(rows[0].requests)).toBe(2);
    expect(Number(rows[0].cache_hits)).toBe(1);
    expect(Number(rows[0].cache_misses)).toBe(1);
  });

  it('aggregates the previous day of request_logs into requests_by_country_daily', async () => {
    const zoneId = `rollup-daily-test-${Date.now()}`;
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const now = new Date(today + 30 * 60 * 1000);
    await ch.insert({
      table: 'request_logs',
      values: [
        { timestamp: chDateTime(today - DAY_MS + 10 * 60 * 60 * 1000), zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/a', status_code: 200, cache_status: 'HIT', bytes_sent: 50, duration_ms: 5, country: 'FR', client_ip_hash: 'h3' },
      ],
      format: 'JSONEachRow',
    });

    await rollup.rollupCountryForPreviousDay(now);

    const resultSet = await ch.query({
      query: 'SELECT country, requests, bytes_sent FROM requests_by_country_daily WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ country: string; requests: string; bytes_sent: string }>();
    expect(rows).toEqual([{ country: 'FR', requests: '1', bytes_sent: '50' }]);
  });
});
