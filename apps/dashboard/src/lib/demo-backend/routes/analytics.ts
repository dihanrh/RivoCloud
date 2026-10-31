import { assertValid } from '../http';
import { requireScope, type DemoCtx } from '../context';
import { UUID_PATTERN } from '../ids';
import * as synth from '../analytics';
import type { Route } from '../router';
import { findOwnedZone } from './cdn';

const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** AnalyticsQueryDto validation + the service's range defaults (last 24h) and zone ownership check. */
function parseQuery(ctx: DemoCtx): synth.AnalyticsQuery {
  const caller = requireScope(ctx, 'analytics:read');
  const zoneId = ctx.query.get('zoneId');
  const from = ctx.query.get('from');
  const to = ctx.query.get('to');
  const granularity = ctx.query.get('granularity');
  assertValid([
    zoneId !== null && !UUID_PATTERN.test(zoneId) && 'zoneId must be a UUID',
    from !== null && !(ISO_8601.test(from) && !Number.isNaN(Date.parse(from))) && 'from must be a valid ISO 8601 date string',
    to !== null && !(ISO_8601.test(to) && !Number.isNaN(Date.parse(to))) && 'to must be a valid ISO 8601 date string',
    granularity !== null && !['hour', 'day', 'week'].includes(granularity) && 'granularity must be one of the following values: hour, day, week',
  ]);
  const zones = zoneId
    ? [findOwnedZone(ctx, caller.orgId, zoneId)]
    : ctx.world.zones.filter((z) => z.orgId === caller.orgId);
  const toMs = to ? Date.parse(to) : ctx.now;
  const fromMs = from ? Date.parse(from) : toMs - 24 * 3600_000;
  return { zones, from: fromMs, to: toMs, granularity: (granularity as 'hour' | 'day' | 'week' | null) ?? 'hour', now: ctx.now };
}

const endpoint = (name: string, run: (ctx: DemoCtx, q: synth.AnalyticsQuery) => unknown): Route => ({
  method: 'GET',
  pattern: `/api/v1/analytics/${name}`,
  handler: (ctx) => run(ctx, parseQuery(ctx)),
});

export const analyticsRoutes: Route[] = [
  endpoint('overview', (ctx, q) => synth.overview(ctx.world, q)),
  endpoint('bandwidth', (ctx, q) => synth.bandwidth(ctx.world, q)),
  endpoint('requests', (ctx, q) => synth.requests(ctx.world, q)),
  endpoint('cache', (ctx, q) => synth.cache(ctx.world, q)),
  endpoint('geography', (ctx, q) => synth.geography(ctx.world, q)),
  endpoint('latency', (ctx, q) => synth.latency(ctx.world, q)),
  endpoint('status-codes', (ctx, q) => synth.statusCodes(ctx.world, q)),
  endpoint('top-paths', (ctx, q) => synth.topPaths(ctx.world, q)),
];
