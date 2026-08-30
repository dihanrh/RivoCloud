import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import type { PrismaClient } from '@rivocloud/db';
import { CLICKHOUSE } from '../clickhouse/clickhouse.token.js';
import { PRISMA } from '../prisma/prisma.module.js';
import type { AnalyticsQueryDto } from './dto/analytics-query.dto.js';

function bucketFn(granularity: 'hour' | 'day' | 'week' = 'hour'): string {
  switch (granularity) {
    case 'day':
      return 'toStartOfDay';
    case 'week':
      return 'toStartOfWeek';
    default:
      return 'toStartOfHour';
  }
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    @Inject(PRISMA) private readonly db: PrismaClient,
  ) {}

  // Every zone_id column in ClickHouse is un-owned data — Postgres is the
  // only source of truth for "which org owns this zone" (this plan's Design
  // Decision 5), so every query resolves the caller's owned zone IDs first
  // and filters ClickHouse with zone_id IN (...) uniformly across all three
  // tables, rather than trusting an org_id column that doesn't even exist on
  // requests_by_country_daily.
  private async zoneIdsForOrg(orgId: string, zoneId?: string): Promise<string[]> {
    if (zoneId) {
      const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
      if (!zone || zone.orgId !== orgId) {
        throw new NotFoundException('Zone not found');
      }
      return [zoneId];
    }
    const zones = await this.db.pullZone.findMany({ where: { orgId }, select: { id: true } });
    return zones.map((z) => z.id);
  }

  // Returns real `Date` objects, not formatted strings. `@clickhouse/client`
  // serializes a `Date` query-parameter value as a time-zone-agnostic Unix
  // timestamp (see its format_query_params.js's `value instanceof Date`
  // branch), which ClickHouse parses unambiguously regardless of the
  // server/session's default timezone. A space-separated string like
  // "2026-06-29 00:00:00.000" (no offset) would instead be interpreted using
  // that session default — which happens to be UTC only because the
  // clickhouse-server Docker image defaults to UTC and nothing here pins
  // TZ/session timezone explicitly. Binding real `Date` objects sidesteps
  // that assumption entirely, matching `request_logs.timestamp`'s declared
  // `DateTime64(3, 'UTC')` column type correctly under any server default.
  private range(query: AnalyticsQueryDto): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    return { from, to };
  }

  async overview(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { bytesSent: 0, requests: 0, hitRatio: 0 };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT sum(bytes_sent) AS bytesSent, count() AS requests, countIf(cache_status = 'HIT') AS cacheHits
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    const [row] = await resultSet.json<{ bytesSent: string; requests: string; cacheHits: string }>();
    const requests = Number(row?.requests ?? 0);
    const cacheHits = Number(row?.cacheHits ?? 0);
    return { bytesSent: Number(row?.bytesSent ?? 0), requests, hitRatio: requests > 0 ? cacheHits / requests : 0 };
  }

  async bandwidth(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { series: [] };
    const { from, to } = this.range(query);
    const bucket = bucketFn(query.granularity);
    const resultSet = await this.ch.query({
      query: `
        SELECT ${bucket}(hour) AS bucket, sum(bytes_sent) AS bytesSent, sum(requests) AS requests
        FROM bandwidth_hourly
        WHERE zone_id IN {zoneIds:Array(String)} AND hour BETWEEN {from:DateTime} AND {to:DateTime}
        GROUP BY bucket
        ORDER BY bucket
      `,
      // bandwidth_hourly.hour is a second-precision DateTime column (no
      // fractional seconds). Passing whole-second Unix integers (rather than
      // the Date objects themselves, which the client would serialize with
      // a ".sss" suffix whenever the millisecond component is non-zero)
      // keeps this timezone-agnostic like the DateTime64 queries above,
      // while guaranteeing a value DateTime's parser accepts outright.
      query_params: { zoneIds, from: Math.floor(from.getTime() / 1000), to: Math.floor(to.getTime() / 1000) },
      format: 'JSONEachRow',
    });
    return { series: await resultSet.json() };
  }

  async requests(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { series: [] };
    const { from, to } = this.range(query);
    const bucket = bucketFn(query.granularity);
    const resultSet = await this.ch.query({
      query: `
        SELECT ${bucket}(timestamp) AS bucket, count() AS requests
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY bucket
        ORDER BY bucket
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { series: await resultSet.json() };
  }

  async cache(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { hitRatio: 0, breakdown: [] };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT cache_status AS cacheStatus, count() AS requests
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY cache_status
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    const breakdown = await resultSet.json<{ cacheStatus: string; requests: string }>();
    const total = breakdown.reduce((sum, row) => sum + Number(row.requests), 0);
    const hits = breakdown.find((row) => row.cacheStatus === 'HIT');
    return {
      hitRatio: total > 0 ? Number(hits?.requests ?? 0) / total : 0,
      breakdown: breakdown.map((row) => ({ cacheStatus: row.cacheStatus, requests: Number(row.requests) })),
    };
  }

  async geography(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { countries: [] };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT country, sum(requests) AS requests, sum(bytes_sent) AS bytesSent
        FROM requests_by_country_daily
        WHERE zone_id IN {zoneIds:Array(String)} AND date BETWEEN {from:Date} AND {to:Date}
        GROUP BY country
        ORDER BY requests DESC
        LIMIT 20
      `,
      // The `date` column is a plain calendar-day `Date` type — no
      // time-of-day, so no timezone ambiguity to worry about here. Deriving
      // the day string from the Date object's UTC fields keeps this in sync
      // with how `request_logs.timestamp` (DateTime64(3, 'UTC')) buckets by
      // day elsewhere, rather than the server's local calendar day.
      query_params: { zoneIds, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      format: 'JSONEachRow',
    });
    return { countries: await resultSet.json() };
  }

  async latency(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { series: [] };
    const { from, to } = this.range(query);
    const bucket = bucketFn(query.granularity);
    const resultSet = await this.ch.query({
      query: `
        SELECT
          ${bucket}(timestamp) AS bucket,
          quantile(0.50)(duration_ms) AS p50,
          quantile(0.95)(duration_ms) AS p95,
          quantile(0.99)(duration_ms) AS p99
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY bucket
        ORDER BY bucket
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { series: await resultSet.json() };
  }

  async statusCodes(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { breakdown: [] };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT status_code AS statusCode, count() AS requests
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY status_code
        ORDER BY requests DESC
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { breakdown: await resultSet.json() };
  }

  async topPaths(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { paths: [] };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT path, count() AS requests, sum(bytes_sent) AS bytesSent
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY path
        ORDER BY requests DESC
        LIMIT 50
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { paths: await resultSet.json() };
  }
}
