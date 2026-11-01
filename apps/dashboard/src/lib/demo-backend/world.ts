import { hashPassword, randomBase58, seedId, sha256 } from './ids';
import type {
  ApiKey,
  AuditLogEntry,
  Bucket,
  CacheInvalidation,
  CacheRule,
  OrgRole,
  Organization,
  StorageObject,
  Zone,
  ZoneDomain,
} from '../types';

// ---------- records (the "database rows" of the demo backend) ----------

export interface UserRec {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface OrgRec extends Organization {
  ownerId: string;
}

export interface MemberRec {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  invitedBy: string | null;
  joinedAt: string | null;
  createdAt: string;
}

export interface ApiKeyRec extends ApiKey {
  orgId: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface AuditRec extends AuditLogEntry {
  orgId: string | null;
}

export interface ZoneRec extends Omit<Zone, 'hasSigningSecret'> {
  signingSecret: string | null;
}

export type DomainRec = Omit<ZoneDomain, 'cnameTarget'>;

export interface ObjectRec extends Omit<StorageObject, 'size'> {
  size: number | null;
}

export interface World {
  users: UserRec[];
  orgs: OrgRec[];
  members: MemberRec[];
  apiKeys: ApiKeyRec[];
  audit: AuditRec[];
  auditSeq: number;
  zones: ZoneRec[];
  /** Zones with a synthetic traffic history (the seeded ones); new zones only get traffic after creation. */
  historicZoneIds: Set<string>;
  domains: DomainRec[];
  rules: CacheRule[];
  invalidations: CacheInvalidation[];
  buckets: Bucket[];
  objects: ObjectRec[];
  revokedRefreshTokens: Set<string>;
  createdAt: number;
  lastAccess: number;
}

// ---------- demo dataset (mirrors scripts/seed-demo.mjs) ----------

export const DEMO_PASSWORD = 'DemoPass123!';
export const DEMO_ORG_ID = seedId('org:acme-media');
export const EDGE_HOSTNAME = 'edge.rivocloud.dev';

export const DEMO_USERS: { key: string; email: string; name: string; role: OrgRole }[] = [
  { key: 'owner', email: 'owner@demo.rivo', name: 'Demo Owner', role: 'owner' },
  { key: 'admin', email: 'admin@demo.rivo', name: 'Demo Admin', role: 'admin' },
  { key: 'dev', email: 'dev@demo.rivo', name: 'Demo Developer', role: 'developer' },
  { key: 'viewer', email: 'viewer@demo.rivo', name: 'Demo Viewer', role: 'viewer' },
];

export const userId = (key: string) => seedId(`user:${key}`);
export const zoneIdFor = (name: string) => seedId(`zone:${name}`);
export const bucketIdFor = (name: string) => seedId(`bucket:${name}`);

const DEMO_IP = '203.0.113.24';
const DEMO_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function createSeedWorld(nowMs = Date.now()): World {
  const at = (msAgo: number) => new Date(nowMs - msAgo).toISOString();
  const world: World = {
    users: [],
    orgs: [],
    members: [],
    apiKeys: [],
    audit: [],
    auditSeq: 1000,
    zones: [],
    historicZoneIds: new Set(),
    domains: [],
    rules: [],
    invalidations: [],
    buckets: [],
    objects: [],
    revokedRefreshTokens: new Set(),
    createdAt: nowMs,
    lastAccess: nowMs,
  };

  const userRef = (key: string) => {
    const u = world.users.find((x) => x.id === userId(key))!;
    return { id: u.id, email: u.email, name: u.name };
  };
  const log = (
    msAgo: number,
    actor: string,
    action: string,
    resourceType: string | null,
    resourceId: string | null,
    metadata: Record<string, unknown>,
    apiKey: AuditRec['apiKey'] = null,
  ) => {
    world.auditSeq += 1;
    world.audit.push({
      id: String(world.auditSeq),
      orgId: DEMO_ORG_ID,
      action,
      resourceType,
      resourceId,
      ipAddress: apiKey ? '198.51.100.7' : DEMO_IP,
      userAgent: apiKey ? 'rivocloud-cli/1.4.0 (linux; ci)' : DEMO_UA,
      metadata,
      createdAt: at(msAgo),
      user: userRef(actor),
      apiKey,
    });
  };

  // Users, org, members
  for (const [i, u] of DEMO_USERS.entries()) {
    world.users.push({
      id: userId(u.key),
      email: u.email,
      name: u.name,
      passwordHash: hashPassword(DEMO_PASSWORD),
      avatarUrl: null,
      emailVerified: true,
      createdAt: at(31 * DAY - i * HOUR),
    });
  }
  world.orgs.push({
    id: DEMO_ORG_ID,
    name: 'Acme Media',
    slug: 'acme-media',
    ownerId: userId('owner'),
    createdAt: at(30 * DAY),
    updatedAt: at(30 * DAY),
  });
  log(30 * DAY, 'owner', 'org.created', 'organization', DEMO_ORG_ID, { params: {} });
  for (const [i, u] of DEMO_USERS.entries()) {
    const joined = at(30 * DAY - i * 20 * MINUTE);
    world.members.push({
      id: seedId(`member:${u.key}`),
      orgId: DEMO_ORG_ID,
      userId: userId(u.key),
      role: u.role,
      invitedBy: u.role === 'owner' ? null : userId('owner'),
      joinedAt: joined,
      createdAt: joined,
    });
    if (u.role !== 'owner') {
      log(30 * DAY - i * 20 * MINUTE, 'owner', 'member.added', 'member', userId(u.key), {
        params: { orgId: DEMO_ORG_ID },
        body: { email: u.email, role: u.role },
      });
    }
  }

  // Websites
  const zoneSpecs = [
    { name: 'acme-shop', originUrl: 'https://shop.acme.example', ago: 21 * DAY },
    { name: 'acme-blog', originUrl: 'https://blog.acme.example', ago: 18 * DAY },
    { name: 'media-assets', originUrl: 'https://assets.acme.example', ago: 12 * DAY },
  ];
  for (const spec of zoneSpecs) {
    const id = zoneIdFor(spec.name);
    world.zones.push({
      id,
      orgId: DEMO_ORG_ID,
      projectId: null,
      name: spec.name,
      slug: spec.name,
      originUrl: spec.originUrl,
      originProtocol: 'https',
      cacheTtl: 3600,
      browserTtl: 0,
      enabled: true,
      signedUrlsRequired: false,
      signingSecret: null,
      createdAt: at(spec.ago),
      updatedAt: at(spec.ago),
    });
    world.historicZoneIds.add(id);
    log(spec.ago, 'owner', 'zone.created', 'zone', id, { params: {} });
  }
  const shop = zoneIdFor('acme-shop');
  const blog = zoneIdFor('acme-blog');
  const assets = zoneIdFor('media-assets');

  // Cache rules on acme-shop
  const ruleDefs: Omit<CacheRule, 'id' | 'zoneId' | 'createdAt'>[] = [
    { pattern: '/static/*', patternType: 'glob', action: 'cache', edgeTtl: 86400, browserTtl: 86400, queryString: 'strip_all', queryWhitelist: [], priority: 10 },
    { pattern: '/api/*', patternType: 'glob', action: 'bypass', edgeTtl: null, browserTtl: null, queryString: 'include_all', queryWhitelist: [], priority: 20 },
    { pattern: '*.html', patternType: 'glob', action: 'cache', edgeTtl: 300, browserTtl: 60, queryString: 'strip_all', queryWhitelist: [], priority: 30 },
  ];
  for (const [i, def] of ruleDefs.entries()) {
    const id = seedId(`rule:acme-shop:${i}`);
    const ago = 20 * DAY - i * 7 * MINUTE;
    world.rules.push({ id, zoneId: shop, createdAt: at(ago), ...def });
    log(ago, 'dev', 'cache_rule.created', 'cache_rule', id, { params: { zoneId: shop } });
  }

  // Signed URLs on media-assets
  const assetsZone = world.zones.find((z) => z.id === assets)!;
  assetsZone.signedUrlsRequired = true;
  assetsZone.signingSecret = sha256(`signing:${assets}`);
  assetsZone.updatedAt = at(10 * DAY);
  log(10 * DAY, 'owner', 'zone.updated', 'zone', assets, { params: { zoneId: assets }, body: { signedUrlsRequired: true } });

  // Past purge on acme-blog, then pause it
  const purgeId = seedId('invalidation:acme-blog:purge');
  world.invalidations.push({
    id: purgeId,
    zoneId: blog,
    createdBy: userId('dev'),
    patterns: ['*'],
    tags: [],
    status: 'completed',
    edgesNotified: 3,
    keysPurged: 1842,
    completedAt: at(6 * DAY - 4000),
    createdAt: at(6 * DAY),
  });
  log(6 * DAY, 'dev', 'cache.purged', 'zone', blog, { params: { zoneId: blog } });
  const blogZone = world.zones.find((z) => z.id === blog)!;
  blogZone.enabled = false;
  blogZone.updatedAt = at(6 * DAY - 10 * MINUTE);
  log(6 * DAY - 10 * MINUTE, 'owner', 'zone.updated', 'zone', blog, { params: { zoneId: blog }, body: { enabled: false } });

  // API key "CI deploy"
  const keyId = seedId('apikey:ci-deploy');
  const keyPrefix = `rc_live_${randomBase58(4)}`;
  world.apiKeys.push({
    id: keyId,
    orgId: DEMO_ORG_ID,
    userId: userId('owner'),
    name: 'CI deploy',
    keyPrefix,
    permissions: ['zone:read', 'cache:invalidate'],
    lastUsedAt: at(3 * HOUR),
    expiresAt: null,
    createdAt: at(9 * DAY),
    revokedAt: null,
  });
  log(9 * DAY, 'owner', 'api_key.created', 'api_key', keyId, {
    params: {},
    body: { name: 'CI deploy', permissions: ['zone:read', 'cache:invalidate'] },
  });

  // A CI-driven invalidation on acme-shop, made with that key
  const ciInvalidation = seedId('invalidation:acme-shop:ci');
  world.invalidations.push({
    id: ciInvalidation,
    zoneId: shop,
    createdBy: userId('owner'),
    patterns: ['/static/app.js', '/static/styles.css'],
    tags: [],
    status: 'completed',
    edgesNotified: 3,
    keysPurged: 6,
    completedAt: at(3 * HOUR - 2500),
    createdAt: at(3 * HOUR),
  });
  log(
    3 * HOUR,
    'owner',
    'cache.invalidated',
    'zone',
    shop,
    { params: { zoneId: shop }, body: { patterns: ['/static/app.js', '/static/styles.css'] } },
    { id: keyId, name: 'CI deploy', keyPrefix },
  );

  // Custom domain waiting for DNS
  const domainId = seedId('domain:www.acme-shop.example');
  world.domains.push({
    id: domainId,
    zoneId: shop,
    domain: 'www.acme-shop.example',
    sslStatus: 'pending_dns',
    sslError: null,
    certExpiresAt: null,
    isPrimary: false,
    verifiedAt: null,
    createdAt: at(2 * DAY),
  });
  log(2 * DAY, 'owner', 'domain.created', 'domain', domainId, {
    params: { zoneId: shop },
    body: { domain: 'www.acme-shop.example' },
  });

  // Buckets and objects
  const bucketSpecs = [
    { name: 'product-images', public: true, ago: 15 * DAY },
    { name: 'invoices', public: false, ago: 15 * DAY - HOUR },
  ];
  for (const spec of bucketSpecs) {
    const id = bucketIdFor(spec.name);
    world.buckets.push({
      id,
      orgId: DEMO_ORG_ID,
      projectId: null,
      name: spec.name,
      region: 'eu-central',
      versioningEnabled: false,
      public: spec.public,
      lifecycleRules: null,
      createdAt: at(spec.ago),
    });
    log(spec.ago, 'admin', 'bucket.created', 'bucket', id, { params: {} });
  }
  const objectSpecs: [bucket: string, key: string, contentType: string, size: number, daysAgo: number][] = [
    ['product-images', 'hero/summer-sale.png', 'image/png', 184_320, 14],
    ['product-images', 'products/sneaker-red.png', 'image/png', 96_412, 13],
    ['product-images', 'products/sneaker-blue.png', 'image/png', 98_007, 13],
    ['product-images', 'products/backpack-green.png', 'image/png', 121_536, 11],
    ['product-images', 'catalog.json', 'application/json', 2_318, 4],
    ['invoices', '2026/INV-1001.txt', 'text/plain', 58, 9],
    ['invoices', '2026/INV-1002.txt', 'text/plain', 57, 5],
    ['invoices', '2026/summary.json', 'application/json', 64, 3],
  ];
  for (const [bucketName, key, contentType, size, daysAgo] of objectSpecs) {
    const bucketId = bucketIdFor(bucketName);
    const versionId = seedId(`object-version:${bucketName}:${key}`);
    const ago = daysAgo * DAY;
    world.objects.push({
      id: seedId(`object:${bucketName}:${key}`),
      bucketId,
      key,
      versionId,
      isLatest: true,
      size,
      contentType,
      etag: sha256(`${bucketName}/${key}`).slice(0, 32),
      storagePath: `rc-${bucketId}/${key}/${versionId}`,
      metadata: null,
      status: 'ready',
      expiresAt: null,
      createdAt: at(ago),
      updatedAt: at(ago - 2000),
    });
    log(ago, 'dev', 'object.upload_initiated', 'bucket', bucketId, {
      params: { bucketId },
      body: { key, contentType },
    });
  }

  // Entries were logged in dataset order, not time order; renumber so ids follow time like a real bigserial.
  world.audit.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  world.audit.forEach((entry, i) => (entry.id = String(1001 + i)));
  world.auditSeq = 1000 + world.audit.length;
  return world;
}

// ---------- per-visitor worlds ----------

const MAX_WORLDS = 200;
/** A world idle this long is reseeded on next use — "data resets periodically". */
export const WORLD_IDLE_RESET_MS = 2 * HOUR;

interface Registry {
  worlds: Map<string, World>;
}

// Kept on globalThis so dev-mode module reloads don't wipe every visitor's state.
const globalRegistry = globalThis as typeof globalThis & { __rivoDemoRegistry?: Registry };

function registry(): Registry {
  if (!globalRegistry.__rivoDemoRegistry) globalRegistry.__rivoDemoRegistry = { worlds: new Map() };
  return globalRegistry.__rivoDemoRegistry;
}

/** The world for a demo session id: an LRU of independent copies of the seed dataset. */
export function getWorld(sessionId: string, nowMs = Date.now()): World {
  const { worlds } = registry();
  let world = worlds.get(sessionId);
  if (world && nowMs - world.lastAccess > WORLD_IDLE_RESET_MS) world = undefined;
  worlds.delete(sessionId);
  if (!world) world = createSeedWorld(nowMs);
  world.lastAccess = nowMs;
  worlds.set(sessionId, world);
  while (worlds.size > MAX_WORLDS) {
    const oldest = worlds.keys().next().value;
    if (oldest === undefined) break;
    worlds.delete(oldest);
  }
  return world;
}

export function resetWorlds(): void {
  registry().worlds.clear();
}
