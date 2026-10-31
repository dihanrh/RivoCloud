import { unitHash } from './ids';
import type { World, ZoneRec } from './world';

/**
 * Deterministic synthetic edge traffic, generated on the fly for any range,
 * granularity and zone. The same (zone, hour) always yields the same numbers,
 * so charts are stable across requests and serverless instances.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;

type Granularity = 'hour' | 'day' | 'week';

interface PathSpec {
  path: string;
  weight: number;
  bytes: number;
}

interface Profile {
  /** Mean requests per hour. */
  base: number;
  avgBytes: number;
  hitRatio: number;
  /** Multiplier on edge latency (large media is slower to serve). */
  latency: number;
  paths: PathSpec[];
  statusMix: Record<number, number>;
}

const STANDARD_STATUS: Record<number, number> = {
  200: 0.884,
  304: 0.068,
  301: 0.012,
  404: 0.026,
  403: 0.003,
  500: 0.0035,
  502: 0.0021,
  503: 0.0014,
};

const PROFILES: Record<string, Profile> = {
  'acme-shop': {
    base: 42_000,
    avgBytes: 46_000,
    hitRatio: 0.952,
    latency: 1,
    statusMix: STANDARD_STATUS,
    paths: [
      { path: '/static/app.js', weight: 0.12, bytes: 182_000 },
      { path: '/static/styles.css', weight: 0.09, bytes: 64_000 },
      { path: '/static/img/hero.webp', weight: 0.09, bytes: 148_000 },
      { path: '/index.html', weight: 0.11, bytes: 21_000 },
      { path: '/products.html', weight: 0.08, bytes: 34_000 },
      { path: '/api/products?page=1', weight: 0.04, bytes: 3_100 },
      { path: '/api/cart', weight: 0.035, bytes: 1_400 },
      { path: '/cart.html', weight: 0.03, bytes: 17_000 },
      { path: '/about.html', weight: 0.02, bytes: 12_000 },
      { path: '/api/checkout', weight: 0.012, bytes: 2_200 },
      ...Array.from({ length: 12 }, (_, i) => ({ path: `/static/img/p/${i + 1}.jpg`, weight: 0.03 - i * 0.0015, bytes: 72_000 + i * 3_000 })),
    ],
  },
  'acme-blog': {
    base: 7_800,
    avgBytes: 28_000,
    hitRatio: 0.931,
    latency: 1.1,
    statusMix: STANDARD_STATUS,
    paths: [
      { path: '/', weight: 0.16, bytes: 26_000 },
      { path: '/assets/main.css', weight: 0.14, bytes: 38_000 },
      { path: '/assets/site.js', weight: 0.13, bytes: 52_000 },
      { path: '/assets/logo.svg', weight: 0.12, bytes: 4_200 },
      { path: '/feed.xml', weight: 0.05, bytes: 61_000 },
      ...Array.from({ length: 10 }, (_, i) => ({ path: `/posts/post-${i + 1}.html`, weight: 0.05 - i * 0.003, bytes: 31_000 + i * 900 })),
    ],
  },
  'media-assets': {
    base: 21_000,
    avgBytes: 310_000,
    hitRatio: 0.928,
    latency: 1.55,
    statusMix: { ...STANDARD_STATUS, 200: 0.84, 206: 0.045, 403: 0.006 },
    paths: [
      { path: '/thumbs/default.png', weight: 0.06, bytes: 12_000 },
      ...Array.from({ length: 16 }, (_, i) => ({ path: `/images/${i + 1}.jpg`, weight: 0.04 - i * 0.0015, bytes: 210_000 + i * 6_000 })),
      ...Array.from({ length: 6 }, (_, i) => ({ path: `/video/clip-${i + 1}.mp4`, weight: 0.03 - i * 0.003, bytes: 920_000 + i * 40_000 })),
    ],
  },
};

const GENERIC_PATHS: PathSpec[] = [
  { path: '/', weight: 0.22, bytes: 24_000 },
  { path: '/assets/app.js', weight: 0.18, bytes: 140_000 },
  { path: '/assets/app.css', weight: 0.14, bytes: 42_000 },
  { path: '/favicon.ico', weight: 0.1, bytes: 4_000 },
  { path: '/images/logo.svg', weight: 0.08, bytes: 6_000 },
  { path: '/robots.txt', weight: 0.03, bytes: 200 },
];

function profileFor(world: World, zone: ZoneRec): Profile {
  if (world.historicZoneIds.has(zone.id) && PROFILES[zone.name]) return PROFILES[zone.name];
  const h = unitHash(zone.id);
  return {
    base: Math.round(1_500 + h * 6_000),
    avgBytes: 40_000,
    hitRatio: 0.9 + h * 0.06,
    latency: 1,
    statusMix: STANDARD_STATUS,
    paths: GENERIC_PATHS,
  };
}

const COUNTRIES: [string, number][] = [
  ['US', 0.3],
  ['IN', 0.14],
  ['GB', 0.1],
  ['DE', 0.095],
  ['BD', 0.08],
  ['JP', 0.07],
  ['BR', 0.06],
  ['FR', 0.045],
  ['CA', 0.04],
  ['AU', 0.03],
  ['NL', 0.02],
  ['SG', 0.02],
];

/** Peaks ~15:00 UTC, troughs ~03:00 UTC (0.35x–1.65x of the mean), quieter weekends. */
function load(hourStart: number): number {
  const d = new Date(hourStart);
  const diurnal = 1 + 0.65 * Math.cos(((d.getUTCHours() - 15) / 24) * 2 * Math.PI);
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 0.82 : 1;
  return diurnal * weekend;
}

function hourlyRequests(world: World, zone: ZoneRec, profile: Profile, hourStart: number): number {
  // Zones created during the demo have no history before they existed.
  if (!world.historicZoneIds.has(zone.id) && hourStart + HOUR <= Date.parse(zone.createdAt)) return 0;
  const noise = 0.88 + 0.24 * unitHash(`${zone.id}:${hourStart}`);
  return profile.base * load(hourStart) * noise;
}

function alignBucket(ms: number, granularity: Granularity): number {
  if (granularity === 'hour') return Math.floor(ms / HOUR) * HOUR;
  const day = Math.floor(ms / DAY) * DAY;
  if (granularity === 'day') return day;
  // ClickHouse toStartOfWeek (mode 0): weeks start on Sunday.
  return day - new Date(day).getUTCDay() * DAY;
}

export interface AnalyticsQuery {
  zones: ZoneRec[];
  from: number;
  to: number;
  granularity: Granularity;
  now: number;
}

interface HourSlice {
  zone: ZoneRec;
  profile: Profile;
  hourStart: number;
  requests: number;
}

/**
 * Every (zone, hour) slice overlapping [from, to], each weighted by its overlap.
 * `wholeHours` keeps only hours entirely inside the range (time series use it, so
 * the in-progress hour doesn't render as a sudden traffic drop).
 */
function slices(world: World, q: AnalyticsQuery, wholeHours = false): HourSlice[] {
  const to = Math.min(q.to, q.now);
  const out: HourSlice[] = [];
  if (to <= q.from) return out;
  const profiles = q.zones.map((zone) => ({ zone, profile: profileFor(world, zone) }));
  for (let h = Math.floor(q.from / HOUR) * HOUR; h < to; h += HOUR) {
    const overlap = (Math.min(h + HOUR, to) - Math.max(h, q.from)) / HOUR;
    if (overlap <= 0 || (wholeHours && overlap < 1)) continue;
    for (const { zone, profile } of profiles) {
      const requests = hourlyRequests(world, zone, profile, h) * overlap;
      if (requests > 0) out.push({ zone, profile, hourStart: h, requests });
    }
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function overview(world: World, q: AnalyticsQuery) {
  let requests = 0;
  let bytes = 0;
  let hits = 0;
  for (const s of slices(world, q)) {
    requests += s.requests;
    bytes += s.requests * s.profile.avgBytes;
    hits += s.requests * s.profile.hitRatio;
  }
  const total = Math.round(requests);
  return { bytesSent: Math.round(bytes), requests: total, hitRatio: total > 0 ? hits / requests : 0 };
}

function series<T>(world: World, q: AnalyticsQuery, init: () => T, add: (acc: T, s: HourSlice) => void) {
  const buckets = new Map<number, T>();
  for (const s of slices(world, q, true)) {
    const key = alignBucket(s.hourStart, q.granularity);
    let acc = buckets.get(key);
    if (!acc) buckets.set(key, (acc = init()));
    add(acc, s);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]);
}

export function bandwidth(world: World, q: AnalyticsQuery) {
  const rows = series(world, q, () => ({ bytes: 0, requests: 0 }), (acc, s) => {
    acc.requests += s.requests;
    acc.bytes += s.requests * s.profile.avgBytes * (0.92 + 0.16 * unitHash(`${s.zone.id}:${s.hourStart}:b`));
  });
  return { series: rows.map(([bucket, v]) => ({ bucket, bytesSent: Math.round(v.bytes), requests: Math.round(v.requests) })) };
}

export function requests(world: World, q: AnalyticsQuery) {
  const rows = series(world, q, () => ({ requests: 0 }), (acc, s) => {
    acc.requests += s.requests;
  });
  return { series: rows.map(([bucket, v]) => ({ bucket, requests: Math.round(v.requests) })) };
}

export function latency(world: World, q: AnalyticsQuery) {
  const rows = series(world, q, () => ({ w: 0, p50: 0, p95: 0, p99: 0 }), (acc, s) => {
    const r1 = unitHash(`${s.zone.id}:${s.hourStart}:p50`);
    const r2 = unitHash(`${s.zone.id}:${s.hourStart}:p95`);
    const r3 = unitHash(`${s.zone.id}:${s.hourStart}:p99`);
    const busy = load(s.hourStart);
    const miss = 1 - s.profile.hitRatio;
    const p50 = (14 + 6 * r1 + 3 * busy) * s.profile.latency;
    const p95 = (70 + 900 * miss + 40 * r2 + 22 * busy) * s.profile.latency;
    const p99 = p95 * (2.3 + 0.6 * r3) + 40 * busy;
    acc.w += s.requests;
    acc.p50 += p50 * s.requests;
    acc.p95 += p95 * s.requests;
    acc.p99 += p99 * s.requests;
  });
  return {
    series: rows.map(([bucket, v]) => ({ bucket, p50: round1(v.p50 / v.w), p95: round1(v.p95 / v.w), p99: round1(v.p99 / v.w) })),
  };
}

export function cache(world: World, q: AnalyticsQuery) {
  const totals = { HIT: 0, MISS: 0, BYPASS: 0 };
  for (const s of slices(world, q)) {
    const miss = 1 - s.profile.hitRatio;
    totals.HIT += s.requests * s.profile.hitRatio;
    totals.MISS += s.requests * miss * 0.72;
    totals.BYPASS += s.requests * miss * 0.28;
  }
  const breakdown = Object.entries(totals)
    .map(([cacheStatus, n]) => ({ cacheStatus, requests: Math.round(n) }))
    .filter((row) => row.requests > 0);
  const total = breakdown.reduce((sum, row) => sum + row.requests, 0);
  return { hitRatio: total > 0 ? (breakdown.find((r) => r.cacheStatus === 'HIT')?.requests ?? 0) / total : 0, breakdown };
}

export function statusCodes(world: World, q: AnalyticsQuery) {
  const totals = new Map<number, number>();
  for (const s of slices(world, q)) {
    for (const [code, share] of Object.entries(s.profile.statusMix)) {
      totals.set(Number(code), (totals.get(Number(code)) ?? 0) + s.requests * share);
    }
  }
  return {
    breakdown: [...totals.entries()]
      .map(([statusCode, n]) => ({ statusCode, requests: Math.round(n) }))
      .filter((row) => row.requests > 0)
      .sort((a, b) => b.requests - a.requests),
  };
}

export function geography(world: World, q: AnalyticsQuery) {
  // requests_by_country_daily is keyed by calendar day: cover whole UTC days.
  const dayQuery = { ...q, from: alignBucket(q.from, 'day'), to: alignBucket(q.to, 'day') + DAY };
  const totals = new Map<string, { requests: number; bytesSent: number }>();
  for (const s of slices(world, dayQuery)) {
    for (const [country, weight] of COUNTRIES) {
      const w = weight * (0.85 + 0.3 * unitHash(`${s.zone.id}:${country}`));
      const row = totals.get(country) ?? { requests: 0, bytesSent: 0 };
      row.requests += s.requests * w;
      row.bytesSent += s.requests * w * s.profile.avgBytes;
      totals.set(country, row);
    }
  }
  return {
    countries: [...totals.entries()]
      .map(([country, v]) => ({ country, requests: Math.round(v.requests), bytesSent: Math.round(v.bytesSent) }))
      .filter((row) => row.requests > 0)
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 20),
  };
}

export function topPaths(world: World, q: AnalyticsQuery) {
  const zoneTotals = new Map<ZoneRec, { profile: Profile; requests: number }>();
  for (const s of slices(world, q)) {
    const t = zoneTotals.get(s.zone) ?? { profile: s.profile, requests: 0 };
    t.requests += s.requests;
    zoneTotals.set(s.zone, t);
  }
  const totals = new Map<string, { requests: number; bytesSent: number }>();
  for (const [zone, { profile, requests: zoneRequests }] of zoneTotals) {
    const weightSum = profile.paths.reduce((sum, p) => sum + p.weight, 0);
    for (const p of profile.paths) {
      const n = zoneRequests * (p.weight / weightSum) * 0.7 * (0.9 + 0.2 * unitHash(`${zone.id}:${p.path}`));
      const row = totals.get(p.path) ?? { requests: 0, bytesSent: 0 };
      row.requests += n;
      row.bytesSent += n * p.bytes;
      totals.set(p.path, row);
    }
  }
  return {
    paths: [...totals.entries()]
      .map(([path, v]) => ({ path, requests: Math.round(v.requests), bytesSent: Math.round(v.bytesSent) }))
      .filter((row) => row.requests > 0)
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 50),
  };
}
