import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { IdentityClient } from '../auth/identity-client.js';

class FakeIdentityClient {
  nextAuth: { type: 'jwt' | 'api_key'; userId: string; orgId: string; role: string | null; permissions?: string[] } | null = null;
  async verifyToken() {
    if (!this.nextAuth) throw new Error('no auth configured');
    return this.nextAuth;
  }
  async verifyApiKey() {
    if (!this.nextAuth) throw new Error('no auth configured');
    return this.nextAuth;
  }
}

describe('AnalyticsController', () => {
  let app: INestApplication;
  let ch: ClickHouseClient;
  let fakeIdentity: FakeIdentityClient;
  let orgId: string;
  let zoneId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityClient)
      .useClass(FakeIdentityClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    fakeIdentity = app.get(IdentityClient) as unknown as FakeIdentityClient;
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await ch.close();
    await app.close();
  });

  beforeEach(async () => {
    const owner = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Analytics Test Owner' } });
    const org = await prisma.organization.create({
      data: { name: 'Analytics Test Org', slug: `analytics-test-org-${randomUUID()}`, ownerId: owner.id },
    });
    orgId = org.id;
    const zone = await prisma.pullZone.create({
      data: { orgId, name: 'Test Zone', slug: `test-zone-${Date.now()}`, originUrl: 'https://api.example.com' },
    });
    zoneId = zone.id;
    fakeIdentity.nextAuth = { type: 'jwt', userId: 'u1', orgId, role: 'owner' };

    const now = '2026-06-29 10:00:00.000';
    await ch.insert({
      table: 'request_logs',
      values: [
        { timestamp: now, zone_id: zoneId, org_id: orgId, datacenter: 'dc1', method: 'GET', path: '/a', status_code: 200, cache_status: 'HIT', bytes_sent: 100, duration_ms: 10, country: 'DE', client_ip_hash: 'h1' },
        { timestamp: now, zone_id: zoneId, org_id: orgId, datacenter: 'dc1', method: 'GET', path: '/b', status_code: 404, cache_status: 'MISS', bytes_sent: 50, duration_ms: 20, country: 'FR', client_ip_hash: 'h2' },
      ],
      format: 'JSONEachRow',
    });
    await ch.insert({
      table: 'bandwidth_hourly',
      values: [{ hour: '2026-06-29 10:00:00', zone_id: zoneId, org_id: orgId, bytes_sent: 150, requests: 2, cache_hits: 1, cache_misses: 1 }],
      format: 'JSONEachRow',
    });
    await ch.insert({
      table: 'requests_by_country_daily',
      values: [{ date: '2026-06-29', zone_id: zoneId, country: 'DE', requests: 1, bytes_sent: 100 }],
      format: 'JSONEachRow',
    });
  });

  // supertest's `request(server)` returns a factory for method-bound Test
  // instances (`.get`/`.post`/...), not an object with `.set` of its own —
  // so the header must be attached after choosing the verb+path, not before.
  const authed = (path: string) => request(app.getHttpServer()).get(path).set('Authorization', 'Bearer test-token');
  const rangeQs = 'from=2026-06-29T00:00:00Z&to=2026-06-30T00:00:00Z';

  it('overview returns totals scoped to the org\'s zones', async () => {
    const response = await authed(`/api/v1/analytics/overview?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ bytesSent: 150, requests: 2, hitRatio: 0.5 });
  });

  // Buckets are epoch-milliseconds in UTC (unambiguous for the browser's
  // `new Date(...)`), and every numeric field is a real JSON number — not
  // ClickHouse's default quoted-string rendering of UInt64.
  const TEN_AM_UTC = Date.UTC(2026, 5, 29, 10);
  const MIDNIGHT_UTC = Date.UTC(2026, 5, 29);
  // toStartOfWeek's default mode starts weeks on Sunday: 2026-06-28.
  const WEEK_START_UTC = Date.UTC(2026, 5, 28);

  it('bandwidth reads from the pre-computed rollup table', async () => {
    const response = await authed(`/api/v1/analytics/bandwidth?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.series).toEqual([{ bucket: TEN_AM_UTC, bytesSent: 150, requests: 2 }]);
  });

  it.each([
    ['day', MIDNIGHT_UTC],
    ['week', WEEK_START_UTC],
  ])('bandwidth buckets by %s as a UTC epoch-ms number', async (granularity, expectedBucket) => {
    const response = await authed(`/api/v1/analytics/bandwidth?${rangeQs}&granularity=${granularity}`);
    expect(response.status).toBe(200);
    expect(response.body.series).toEqual([{ bucket: expectedBucket, bytesSent: 150, requests: 2 }]);
  });

  it('requests returns a time series from raw request_logs', async () => {
    const response = await authed(`/api/v1/analytics/requests?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.series).toEqual([{ bucket: TEN_AM_UTC, requests: 2 }]);
  });

  it('requests and bandwidth agree on bucket boundaries for the same range', async () => {
    const [requests, bandwidth] = await Promise.all([
      authed(`/api/v1/analytics/requests?${rangeQs}&granularity=day`),
      authed(`/api/v1/analytics/bandwidth?${rangeQs}&granularity=day`),
    ]);
    expect(requests.body.series.map((p: { bucket: number }) => p.bucket)).toEqual(
      bandwidth.body.series.map((p: { bucket: number }) => p.bucket),
    );
  });

  it('cache returns a hit ratio and status breakdown', async () => {
    const response = await authed(`/api/v1/analytics/cache?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.hitRatio).toBe(0.5);
    expect(response.body.breakdown).toHaveLength(2);
  });

  it('geography reads from the country rollup table', async () => {
    const response = await authed(`/api/v1/analytics/geography?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.countries).toEqual([{ country: 'DE', requests: 1, bytesSent: 100 }]);
  });

  it('latency returns quantiles', async () => {
    const response = await authed(`/api/v1/analytics/latency?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.series).toHaveLength(1);
    const [point] = response.body.series;
    expect(point.bucket).toBe(TEN_AM_UTC);
    for (const key of ['p50', 'p95', 'p99']) expect(typeof point[key]).toBe('number');
  });

  it('latency buckets by day as a UTC epoch-ms number', async () => {
    const response = await authed(`/api/v1/analytics/latency?${rangeQs}&granularity=day`);
    expect(response.status).toBe(200);
    expect(response.body.series).toHaveLength(1);
    expect(response.body.series[0].bucket).toBe(MIDNIGHT_UTC);
  });

  it('status-codes returns a breakdown', async () => {
    const response = await authed(`/api/v1/analytics/status-codes?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.breakdown).toHaveLength(2);
    expect(response.body.breakdown).toEqual(
      expect.arrayContaining([
        { statusCode: 200, requests: 1 },
        { statusCode: 404, requests: 1 },
      ]),
    );
  });

  it('top-paths returns both paths ordered by requests', async () => {
    const response = await authed(`/api/v1/analytics/top-paths?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.paths).toHaveLength(2);
    expect(response.body.paths).toEqual(
      expect.arrayContaining([
        { path: '/a', requests: 1, bytesSent: 100 },
        { path: '/b', requests: 1, bytesSent: 50 },
      ]),
    );
  });

  it('returns 400 (not a Prisma 500) for a non-UUID zoneId', async () => {
    const response = await authed(`/api/v1/analytics/overview?zoneId=abc&${rangeQs}`);
    expect(response.status).toBe(400);
  });

  it('returns 404 when zoneId does not belong to the caller\'s org', async () => {
    const otherOwner = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Other Org Owner' } });
    const other = await prisma.organization.create({
      data: { name: 'Other Org', slug: `other-org-${randomUUID()}`, ownerId: otherOwner.id },
    });
    const otherZone = await prisma.pullZone.create({
      data: { orgId: other.id, name: 'Other Zone', slug: `other-zone-${Date.now()}`, originUrl: 'https://api.example.com' },
    });
    const response = await authed(`/api/v1/analytics/overview?zoneId=${otherZone.id}&${rangeQs}`);
    expect(response.status).toBe(404);
  });
});
