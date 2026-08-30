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

  // ClickHouse's DateTime/DateTime64 query-parameter binder (like its
  // JSONEachRow insert parser) rejects RFC3339's `T`/`Z` suffix, so `from`/
  // `to` are formatted as ClickHouse-native "YYYY-MM-DD HH:MM:SS.sss"
  // instead of `Date#toISOString()`'s ISO 8601 form.
  private range(query: AnalyticsQueryDto): { from: string; to: string } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const toChDateTime = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');
    return { from: toChDateTime(from), to: toChDateTime(to) };
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
      // fractional seconds), so the ".sss" from range() must be trimmed —
      // same reasoning as geography's Date-column `.slice(0, 10)` below.
      query_params: { zoneIds, from: from.slice(0, 19), to: to.slice(0, 19) },
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
      query_params: { zoneIds, from: from.slice(0, 10), to: to.slice(0, 10) },
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
