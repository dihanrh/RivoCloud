#!/usr/bin/env node
// Seeds a running RivoCloud stack with a populated demo org.
// Plain Node ESM, global fetch only. Idempotent: re-running reuses what exists.
//
//   node scripts/seed-demo.mjs
//
// Environment (all optional, defaults match scripts/demo.sh):
//   IDENTITY_SERVICE_URL, CDN_SERVICE_URL, STORAGE_SERVICE_URL, ANALYTICS_SERVICE_URL,
//   CLICKHOUSE_URL, INTERNAL_API_SECRET, MINIO_WEBHOOK_AUTH_TOKEN, DASHBOARD_URL

const env = process.env;
const IDENTITY = env.IDENTITY_SERVICE_URL || 'http://localhost:3001';
const CDN = env.CDN_SERVICE_URL || 'http://localhost:3003';
const STORAGE = env.STORAGE_SERVICE_URL || 'http://localhost:3004';
const ANALYTICS = env.ANALYTICS_SERVICE_URL || 'http://localhost:3006';
const CLICKHOUSE = env.CLICKHOUSE_URL || 'http://localhost:8123';
const INTERNAL_SECRET = env.INTERNAL_API_SECRET || 'dev_internal_secret_change_me_please_1234';
const WEBHOOK_TOKEN = env.MINIO_WEBHOOK_AUTH_TOKEN || 'dev_minio_webhook_token_change_me';
const DASHBOARD = env.DASHBOARD_URL || 'http://localhost:3000';

const PASSWORD = 'DemoPass123!';
const ORG_NAME = 'Acme Media';
const USERS = [
  { email: 'owner@demo.rivo', name: 'Ava Owner', role: 'owner' },
  { email: 'admin@demo.rivo', name: 'Sam Admin', role: 'admin' },
  { email: 'dev@demo.rivo', name: 'Dev Patel', role: 'developer' },
  { email: 'viewer@demo.rivo', name: 'Vic Viewer', role: 'viewer' },
];
const INGEST_BATCH = 300; // keeps each request body well under Nest's default 100kb JSON limit
const DAYS = 7;

const log = (...a) => console.log('[seed]', ...a);

class HttpError extends Error {
  constructor(status, body, method, url) {
    super(`${method} ${url} -> ${status} ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function http(method, url, { token, body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined && !raw) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (raw) {
    payload = body;
  }
  const res = await fetch(url, { method, headers: h, body: payload });
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new HttpError(res.status, data, method, url);
  return { data, headers: res.headers, status: res.status };
}

/** Pulls the first array out of a list response, whatever the envelope key is. */
function items(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const v of Object.values(data)) if (Array.isArray(v)) return v;
  }
  return [];
}

// ---------- identity ----------

async function ensureUser(u) {
  try {
    await http('POST', `${IDENTITY}/api/v1/auth/register`, { body: { email: u.email, password: PASSWORD, name: u.name } });
    log(`registered ${u.email}`);
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 409)) throw e;
    log(`user exists: ${u.email}`);
  }
  const { data } = await http('POST', `${IDENTITY}/api/v1/auth/login`, { body: { email: u.email, password: PASSWORD } });
  return data.accessToken;
}

async function ensureOrg(ownerToken) {
  const { data } = await http('GET', `${IDENTITY}/api/v1/orgs`, { token: ownerToken });
  const existing = items(data).find((o) => o.name === ORG_NAME);
  if (existing) {
    log(`org exists: ${ORG_NAME}`);
    const t = await http('POST', `${IDENTITY}/api/v1/auth/select-org`, { token: ownerToken, body: { orgId: existing.id } });
    return { org: existing, token: t.data.accessToken };
  }
  const created = await http('POST', `${IDENTITY}/api/v1/orgs`, { token: ownerToken, body: { name: ORG_NAME } });
  log(`created org ${ORG_NAME}`);
  return { org: created.data.organization, token: created.data.accessToken };
}

async function ensureMembers(orgId, token) {
  for (const u of USERS.filter((x) => x.role !== 'owner')) {
    try {
      await http('POST', `${IDENTITY}/api/v1/orgs/${orgId}/members`, { token, body: { email: u.email, role: u.role } });
      log(`added member ${u.email} as ${u.role}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) log(`member exists: ${u.email}`);
      else throw e;
    }
  }
}

async function ensureApiKey(token) {
  const { data } = await http('GET', `${IDENTITY}/api/v1/api-keys`, { token });
  if (items(data).some((k) => k.name === 'CI deploy')) {
    log('api key exists: CI deploy');
    return null;
  }
  const created = await http('POST', `${IDENTITY}/api/v1/api-keys`, {
    token,
    body: { name: 'CI deploy', permissions: ['zone:read', 'cache:invalidate'] },
  });
  log('created api key: CI deploy');
  return created.data.key || created.data.rawKey || created.data.apiKey || created.data.secret || null;
}

// ---------- cdn ----------

const ZONES = [
  { name: 'acme-shop', originUrl: 'https://shop.acme.example', traffic: 150 },
  { name: 'acme-blog', originUrl: 'https://blog.acme.example', traffic: 45, pause: true },
  { name: 'media-assets', originUrl: 'https://assets.acme.example', traffic: 95, signed: true },
];

async function ensureZones(token) {
  const { data } = await http('GET', `${CDN}/api/v1/zones?take=100`, { token });
  const existing = items(data);
  const out = {};
  for (const z of ZONES) {
    let zone = existing.find((e) => e.name === z.name);
    if (zone) {
      log(`zone exists: ${z.name}`);
    } else {
      zone = (await http('POST', `${CDN}/api/v1/zones`, { token, body: { name: z.name, originUrl: z.originUrl } })).data;
      log(`created zone ${z.name}`);
    }
    out[z.name] = { ...zone, spec: z };
  }
  return out;
}

async function configureShop(token, zone) {
  const base = `${CDN}/api/v1/zones/${zone.id}`;
  const rules = items((await http('GET', `${base}/rules`, { token })).data);
  if (rules.length === 0) {
    const defs = [
      { pattern: '/static/*', patternType: 'glob', action: 'cache', edgeTtl: 86400, browserTtl: 86400, queryString: 'strip_all', priority: 10 },
      { pattern: '/api/*', patternType: 'glob', action: 'bypass', queryString: 'include_all', priority: 20 },
      { pattern: '*.html', patternType: 'glob', action: 'cache', edgeTtl: 300, browserTtl: 60, queryString: 'strip_all', priority: 30 },
    ];
    for (const r of defs) await http('POST', `${base}/rules`, { token, body: r });
    log('created 3 cache rules on acme-shop');
  } else {
    log(`acme-shop already has ${rules.length} rule(s)`);
  }
  const domains = items((await http('GET', `${base}/domains`, { token })).data);
  if (!domains.some((d) => d.domain === 'www.acme-shop.example')) {
    await http('POST', `${base}/domains`, { token, body: { domain: 'www.acme-shop.example' } });
    log('added custom domain www.acme-shop.example');
  } else {
    log('custom domain exists');
  }
}

async function configureBlogAndAssets(token, zones) {
  const blog = zones['acme-blog'];
  const inv = items((await http('GET', `${CDN}/api/v1/zones/${blog.id}/cache/invalidations`, { token })).data);
  if (inv.length === 0) {
    await http('POST', `${CDN}/api/v1/zones/${blog.id}/cache/purge`, { token });
    log('purged everything on acme-blog');
  } else {
    log('acme-blog already has purge history');
  }
  // Pause the blog AFTER purging (a paused zone may refuse cache operations).
  if (blog.enabled !== false) {
    await http('PATCH', `${CDN}/api/v1/zones/${blog.id}`, { token, body: { enabled: false } });
    log('paused acme-blog');
  }
  const assets = zones['media-assets'];
  if (!assets.signedUrlsRequired) {
    await http('PATCH', `${CDN}/api/v1/zones/${assets.id}`, { token, body: { signedUrlsRequired: true } });
    log('enabled signed URLs on media-assets');
  }
}

// ---------- storage ----------

function pngBytes(r, g, b) {
  // Valid 8x8 solid-colour PNG, built with node:zlib (no deps).
  return import('node:zlib').then(({ deflateSync }) => {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf) => {
      let c = 0xffffffff;
      for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type), data]);
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc(td));
      return Buffer.concat([len, td, c]);
    };
    const w = 8;
    const h = 8;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
    const raw = Buffer.concat(Array.from({ length: h }, () => row));
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  });
}

async function ensureBuckets(token) {
  const { data } = await http('GET', `${STORAGE}/api/v1/buckets`, { token });
  const existing = items(data);
  const specs = [
    { name: 'product-images', public: true },
    { name: 'invoices', public: false },
  ];
  const out = {};
  for (const s of specs) {
    let b = existing.find((e) => e.name === s.name);
    if (b) log(`bucket exists: ${s.name}`);
    else {
      b = (await http('POST', `${STORAGE}/api/v1/buckets`, { token, body: s })).data;
      log(`created bucket ${s.name}`);
    }
    out[s.name] = b;
  }
  return out;
}

async function uploadObject(token, bucket, key, contentType, bytes) {
  const { data } = await http('POST', `${STORAGE}/api/v1/buckets/${bucket.id}/objects/upload`, {
    token,
    body: { key, contentType, size: bytes.length },
  });
  const put = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes });
  if (!put.ok) throw new Error(`MinIO PUT failed for ${key}: ${put.status} ${await put.text()}`);
  const etag = (put.headers.get('etag') || '').replace(/"/g, '') || 'demo-etag';
  // Tell storage-service the object landed. MinIO's own bucket notification may or may not be wired
  // to this host, so the seed delivers the same payload itself (idempotent for the same version).
  const u = new URL(data.uploadUrl);
  const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const slash = path.indexOf('/');
  const bucketName = path.slice(0, slash);
  const objectKey = path.slice(slash + 1);
  await http('POST', `${STORAGE}/internal/storage/minio-webhook`, {
    headers: { authorization: `Bearer ${WEBHOOK_TOKEN}` },
    body: { Records: [{ s3: { bucket: { name: bucketName }, object: { key: encodeURIComponent(objectKey), size: bytes.length, eTag: etag } } }] },
  });
}

async function seedObjects(token, buckets) {
  const plan = {
    'product-images': [
      ['hero/summer-sale.png', 'image/png', () => pngBytes(240, 120, 60)],
      ['products/sneaker-red.png', 'image/png', () => pngBytes(200, 40, 50)],
      ['products/sneaker-blue.png', 'image/png', () => pngBytes(40, 90, 200)],
      ['products/backpack-green.png', 'image/png', () => pngBytes(40, 150, 90)],
      ['catalog.json', 'application/json', () => Buffer.from(JSON.stringify({ updated: '2026-01-01', items: 4 }, null, 2))],
    ],
    invoices: [
      ['2026/INV-1001.txt', 'text/plain', () => Buffer.from('Invoice INV-1001\nAcme Media\nTotal: $1,240.00\nStatus: paid\n')],
      ['2026/INV-1002.txt', 'text/plain', () => Buffer.from('Invoice INV-1002\nAcme Media\nTotal: $860.50\nStatus: due\n')],
      ['2026/summary.json', 'application/json', () => Buffer.from(JSON.stringify({ year: 2026, invoices: 2, outstanding: 860.5 }, null, 2))],
    ],
  };
  let count = 0;
  for (const [bucketName, objs] of Object.entries(plan)) {
    const bucket = buckets[bucketName];
    const listed = items((await http('GET', `${STORAGE}/api/v1/buckets/${bucket.id}/objects?take=100`, { token })).data);
    const ready = new Set(listed.filter((o) => o.status === 'ready').map((o) => o.key));
    for (const [key, ct, gen] of objs) {
      if (ready.has(key)) continue;
      await uploadObject(token, bucket, key, ct, await gen());
      count++;
    }
  }
  log(count ? `uploaded ${count} object(s)` : 'objects already present');
}

// ---------- analytics ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTRIES = [
  ['US', 0.32, 'iad'],
  ['IN', 0.18, 'bom'],
  ['GB', 0.12, 'lhr'],
  ['DE', 0.12, 'fra'],
  ['BD', 0.1, 'dac'],
  ['JP', 0.08, 'nrt'],
  ['BR', 0.08, 'gru'],
];

function pickWeighted(rnd, list, wi = 1) {
  let x = rnd();
  for (const e of list) {
    x -= e[wi];
    if (x <= 0) return e;
  }
  return list[list.length - 1];
}

const lognormal = (rnd, median, sigma) => {
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(sigma * n);
};

const SITE_PROFILES = {
  'acme-shop': {
    kinds: [
      // [weight, hitRate, makePath, bytes, method]
      [0.62, 0.97, (r) => pickWeighted(r, [['/static/app.js', 0.2], ['/static/styles.css', 0.15], ['/static/img/hero.webp', 0.15], [`/static/img/p/${1 + Math.floor(r() * 40)}.jpg`, 0.5]])[0], 60000, 'static'],
      [0.28, 0.88, (r) => pickWeighted(r, [['/index.html', 0.4], ['/products.html', 0.3], ['/cart.html', 0.15], ['/about.html', 0.15]])[0], 18000, 'html'],
      [0.1, 0, (r) => pickWeighted(r, [['/api/cart', 0.4], [`/api/products?page=${1 + Math.floor(r() * 8)}`, 0.45], ['/api/checkout', 0.15]])[0], 2500, 'api'],
    ],
  },
  'acme-blog': {
    kinds: [
      [0.5, 0.95, (r) => `/assets/${pickWeighted(r, [['main.css', 0.3], ['site.js', 0.3], ['logo.svg', 0.4]])[0]}`, 40000, 'static'],
      [0.5, 0.8, (r) => pickWeighted(r, [['/', 0.25], [`/posts/post-${1 + Math.floor(r() * 30)}.html`, 0.65], ['/feed.xml', 0.1]])[0], 24000, 'html'],
    ],
  },
  'media-assets': {
    kinds: [
      [0.7, 0.9, (r) => `/images/${1 + Math.floor(r() * 120)}.jpg`, 220000, 'static'],
      [0.25, 0.85, (r) => `/video/clip-${1 + Math.floor(r() * 12)}.mp4`, 900000, 'static'],
      [0.05, 0.98, () => '/thumbs/default.png', 12000, 'static'],
    ],
  },
};

function diurnal(hourUtc) {
  // Peaks around 15:00 UTC, trough around 03:00 UTC; between 0.35x and 1.65x of the mean.
  return 1 + 0.65 * Math.cos(((hourUtc - 15) / 24) * 2 * Math.PI);
}

function generateEvents(zone, orgId, seed) {
  const rnd = mulberry32(seed);
  const profile = SITE_PROFILES[zone.name];
  const now = Date.now();
  const hourMs = 3600_000;
  const start = Math.floor(now / hourMs) * hourMs - (DAYS * 24 - 1) * hourMs;
  const visitors = Array.from({ length: 1800 }, () => Array.from({ length: 16 }, () => Math.floor(rnd() * 16).toString(16)).join(''));
  const events = [];
  for (let h = 0; h < DAYS * 24; h++) {
    const hourStart = start + h * hourMs;
    const d = new Date(hourStart);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 0.8 : 1;
    // A gentle upward trend across the week plus noise.
    const trend = 0.85 + 0.3 * (h / (DAYS * 24));
    const n = Math.max(0, Math.round(zone.spec.traffic * diurnal(d.getUTCHours()) * weekend * trend * (0.85 + 0.3 * rnd())));
    for (let i = 0; i < n; i++) {
      const ts = Math.min(now - 1000, hourStart + Math.floor(rnd() * hourMs));
      const [country, , dc] = pickWeighted(rnd, COUNTRIES);
      const [, hitRate, mkPath, bytesBase, kind] = pickWeighted(rnd, profile.kinds);
      const path = mkPath(rnd);
      let cache;
      let status = 200;
      let method = 'GET';
      if (kind === 'api') {
        cache = 'BYPASS';
        if (path === '/api/checkout') method = 'POST';
      } else {
        cache = rnd() < hitRate ? 'HIT' : 'MISS';
        if (rnd() < 0.012) status = 404;
        else if (kind === 'static' && rnd() < 0.06) status = 304;
      }
      const errRoll = rnd();
      if (status === 200 && errRoll < (kind === 'api' ? 0.02 : 0.003)) status = [500, 502, 503][Math.floor(rnd() * 3)];
      const median = status >= 500 ? 900 : cache === 'HIT' ? 16 : cache === 'MISS' ? 130 : 210;
      const duration = Math.max(1, Math.round(lognormal(rnd, median, 0.55)));
      const bytes = status === 304 ? 0 : status === 404 ? 600 : Math.round(bytesBase * (0.4 + rnd() * 1.2));
      events.push({
        timestamp: new Date(ts).toISOString(),
        zone_id: zone.id,
        org_id: orgId,
        datacenter: dc,
        method,
        path,
        status_code: status,
        cache_status: cache,
        bytes_sent: bytes,
        duration_ms: duration,
        country,
        client_ip_hash: visitors[Math.floor(Math.pow(rnd(), 1.6) * visitors.length)],
      });
    }
  }
  return events;
}

async function clickhouseCount(zoneId) {
  try {
    const q = encodeURIComponent(`SELECT count() FROM request_logs WHERE zone_id = '${zoneId}'`);
    const res = await fetch(`${CLICKHOUSE}/?query=${q}`);
    if (!res.ok) return null;
    return Number((await res.text()).trim());
  } catch {
    return null;
  }
}

async function seedTraffic(zones, orgId) {
  let seed = 1337;
  let total = 0;
  for (const zone of Object.values(zones)) {
    seed += 7;
    const existing = await clickhouseCount(zone.id);
    if (existing !== null && existing > 1000) {
      log(`traffic already present for ${zone.name} (${existing} rows)`);
      continue;
    }
    const events = generateEvents(zone, orgId, seed);
    for (let i = 0; i < events.length; i += INGEST_BATCH) {
      await http('POST', `${ANALYTICS}/internal/analytics/events`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
        body: { events: events.slice(i, i + INGEST_BATCH) },
      });
    }
    total += events.length;
    log(`ingested ${events.length} edge events for ${zone.name}`);
  }
  return total;
}

// ---------- main ----------

async function main() {
  log('identity: users');
  const tokens = {};
  for (const u of USERS) tokens[u.email] = await ensureUser(u);

  const { org, token } = await ensureOrg(tokens['owner@demo.rivo']);
  await ensureMembers(org.id, token);
  const apiKey = await ensureApiKey(token);

  log('cdn: websites');
  const zones = await ensureZones(token);
  await configureShop(token, zones['acme-shop']);
  await configureBlogAndAssets(token, zones);

  log('storage: buckets');
  const buckets = await ensureBuckets(token);
  await seedObjects(token, buckets);

  log('analytics: synthetic traffic');
  const events = await seedTraffic(zones, org.id);

  console.log('\n================ Demo seed summary ================');
  console.log(`Org:       ${ORG_NAME} (${org.id})`);
  console.log(`Websites:  ${Object.keys(zones).join(', ')}`);
  console.log(`Buckets:   ${Object.keys(buckets).join(', ')}`);
  console.log(`Traffic:   ${events ? `${events} new edge events (last ${DAYS} days)` : 'already present'}`);
  if (apiKey) console.log(`API key:   "CI deploy" = ${apiKey}  (shown once)`);
  console.log('Users (password: ' + PASSWORD + '):');
  for (const u of USERS) console.log(`  ${u.role.padEnd(10)} ${u.email}`);
  console.log(`Dashboard: ${DASHBOARD}`);
}

main().catch((e) => {
  console.error('[seed] FAILED:', e.message);
  process.exit(1);
});
