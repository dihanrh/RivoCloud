import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';
import { RollupService } from './rollup.service.js';

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
    // "now" fixed to 15:00 UTC so "the previous hour" is a known, fixed
    // window: [14:00, 15:00).
    const now = new Date('2026-07-01T15:00:00.000Z');
    await ch.insert({
      table: 'request_logs',
      values: [
        { timestamp: '2026-07-01 14:15:00.000', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/a', status_code: 200, cache_status: 'HIT', bytes_sent: 100, duration_ms: 5, country: 'DE', client_ip_hash: 'h1' },
        { timestamp: '2026-07-01 14:45:00.000', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/b', status_code: 200, cache_status: 'MISS', bytes_sent: 200, duration_ms: 8, country: 'DE', client_ip_hash: 'h2' },
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
    // 14:00 UTC regardless of the ClickHouse server's default timezone.
    expect(Number(rows[0].hour_epoch)).toBe(Date.UTC(2026, 6, 1, 14) / 1000);
    expect(Number(rows[0].bytes_sent)).toBe(300);
    expect(Number(rows[0].requests)).toBe(2);
    expect(Number(rows[0].cache_hits)).toBe(1);
    expect(Number(rows[0].cache_misses)).toBe(1);
  });

  it('aggregates the previous day of request_logs into requests_by_country_daily', async () => {
    const zoneId = `rollup-daily-test-${Date.now()}`;
    const now = new Date('2026-07-02T00:30:00.000Z');
    await ch.insert({
      table: 'request_logs',
      values: [
        { timestamp: '2026-07-01 10:00:00.000', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/a', status_code: 200, cache_status: 'HIT', bytes_sent: 50, duration_ms: 5, country: 'FR', client_ip_hash: 'h3' },
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
