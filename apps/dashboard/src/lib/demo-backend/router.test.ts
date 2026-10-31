// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, type DemoRequest } from './router';
import { createSeedWorld, DEMO_ORG_ID, DEMO_PASSWORD, zoneIdFor, bucketIdFor, type World } from './world';
import { completeUpload } from './routes/storage';
import { decodeAccessClaims } from './tokens';
import type { Service } from './context';

let world: World;

function call(service: Service, method: string, path: string, opts: Partial<DemoRequest> & { json?: unknown } = {}) {
  const { json, ...rest } = opts;
  return dispatch(world, { service, method, path, body: json === undefined ? undefined : JSON.stringify(json), ...rest });
}

function login(email: string, password = DEMO_PASSWORD) {
  const res = call('identity', 'POST', '/api/v1/auth/login', { json: { email, password } });
  return res.body as { accessToken: string; refreshToken: string };
}

const tokenFor = (who: 'owner' | 'admin' | 'dev' | 'viewer') => login(`${who}@demo.rivo`).accessToken;

beforeEach(() => {
  world = createSeedWorld();
});

describe('demo backend: auth', () => {
  it('logs a demo user in with a decodable, org-scoped access token', () => {
    const res = call('identity', 'POST', '/api/v1/auth/login', { json: { email: 'owner@demo.rivo', password: DEMO_PASSWORD } });
    expect(res.status).toBe(201);
    const { accessToken, refreshToken } = res.body as { accessToken: string; refreshToken: string };
    expect(accessToken.split('.')).toHaveLength(3);
    expect(refreshToken).toMatch(/^rdt_/);
    const claims = decodeAccessClaims(accessToken)!;
    expect(claims).toMatchObject({ org: DEMO_ORG_ID, role: 'owner' });
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    expect(claims.jti).toBeTruthy();
  });

  it('rejects a wrong password with a Nest-shaped 401', () => {
    const res = call('identity', 'POST', '/api/v1/auth/login', { json: { email: 'owner@demo.rivo', password: 'nope-nope' } });
    expect(res).toEqual({ status: 401, body: { statusCode: 401, message: 'Invalid email or password', error: 'Unauthorized' } });
  });

  it('rejects calls without a token', () => {
    expect(call('cdn', 'GET', '/api/v1/zones').status).toBe(401);
  });

  it('registers a new user who then has no org yet', () => {
    const reg = call('identity', 'POST', '/api/v1/auth/register', { json: { email: 'new@example.com', password: 'longenough', name: 'New Person' } });
    expect(reg.status).toBe(201);
    expect(call('identity', 'POST', '/api/v1/auth/register', { json: { email: 'new@example.com', password: 'longenough', name: 'X' } }).status).toBe(409);
    const { accessToken } = login('new@example.com', 'longenough');
    expect(decodeAccessClaims(accessToken)!.org).toBeNull();
    expect(call('identity', 'GET', '/api/v1/orgs', { accessToken }).body).toEqual([]);
  });

  it('refreshes with the opaque refresh token and refuses it after logout', () => {
    const { refreshToken } = login('dev@demo.rivo');
    expect(call('identity', 'POST', '/api/v1/auth/refresh', { json: { refreshToken } }).status).toBe(201);
    call('identity', 'POST', '/api/v1/auth/logout', { json: { refreshToken } });
    expect(call('identity', 'POST', '/api/v1/auth/refresh', { json: { refreshToken } }).status).toBe(401);
  });

  it('reports the live role on /users/me', () => {
    const res = call('identity', 'GET', '/api/v1/users/me', { accessToken: tokenFor('viewer') });
    expect(res.body).toMatchObject({ email: 'viewer@demo.rivo', name: 'Demo Viewer', role: 'viewer' });
  });
});

describe('demo backend: roles', () => {
  it('forbids a viewer from creating a zone', () => {
    const res = call('cdn', 'POST', '/api/v1/zones', { accessToken: tokenFor('viewer'), json: { name: 'x', originUrl: 'https://x.example' } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ statusCode: 403, message: 'Role "viewer" lacks the "zone:write" permission' });
  });

  it('forbids a viewer from creating buckets but lets them read', () => {
    const viewer = tokenFor('viewer');
    expect(call('storage', 'POST', '/api/v1/buckets', { accessToken: viewer, json: { name: 'nope' } }).status).toBe(403);
    expect(call('storage', 'GET', '/api/v1/buckets', { accessToken: viewer }).status).toBe(200);
  });

  it('lets only the owner change roles, and admins only manage developers/viewers', () => {
    const admin = tokenFor('admin');
    const owner = tokenFor('owner');
    const members = `/api/v1/orgs/${DEMO_ORG_ID}/members`;
    const viewerId = world.users.find((u) => u.email === 'viewer@demo.rivo')!.id;
    expect(call('identity', 'PATCH', `${members}/${viewerId}`, { accessToken: admin, json: { role: 'developer' } }).status).toBe(403);
    expect(call('identity', 'PATCH', `${members}/${viewerId}`, { accessToken: owner, json: { role: 'developer' } }).status).toBe(200);

    call('identity', 'POST', '/api/v1/auth/register', { json: { email: 'x@example.com', password: 'longenough', name: 'X' } });
    expect(call('identity', 'POST', members, { accessToken: admin, json: { email: 'x@example.com', role: 'admin' } }).status).toBe(403);
    expect(call('identity', 'POST', members, { accessToken: admin, json: { email: 'x@example.com', role: 'viewer' } }).status).toBe(201);
    expect(call('identity', 'POST', members, { accessToken: admin, json: { email: 'x@example.com', role: 'viewer' } }).status).toBe(409);
    expect(call('identity', 'POST', members, { accessToken: admin, json: { email: 'ghost@example.com', role: 'viewer' } }).status).toBe(404);
  });

  it('restricts the audit log to owners and admins', () => {
    const path = `/api/v1/orgs/${DEMO_ORG_ID}/audit-logs`;
    expect(call('identity', 'GET', path, { accessToken: tokenFor('viewer') }).status).toBe(403);
    expect(call('identity', 'GET', path, { accessToken: tokenFor('dev') }).status).toBe(403);
    expect(call('identity', 'GET', path, { accessToken: tokenFor('admin') }).status).toBe(200);
  });

  it('caps API key scopes by role', () => {
    const res = call('identity', 'POST', '/api/v1/api-keys', { accessToken: tokenFor('viewer'), json: { name: 'k', permissions: ['zone:write'] } });
    expect(res.status).toBe(403);
    expect(call('identity', 'POST', '/api/v1/api-keys', { accessToken: tokenFor('viewer'), json: { name: 'k', permissions: ['zone:read'] } }).status).toBe(201);
  });
});

describe('demo backend: websites', () => {
  it('seeds the demo websites', () => {
    const res = call('cdn', 'GET', '/api/v1/zones', { accessToken: tokenFor('viewer') });
    const { zones, total } = res.body as { zones: { name: string; enabled: boolean; signedUrlsRequired: boolean; hasSigningSecret: boolean }[]; total: number };
    expect(total).toBe(3);
    expect(zones.find((z) => z.name === 'acme-blog')!.enabled).toBe(false);
    expect(zones.find((z) => z.name === 'media-assets')).toMatchObject({ signedUrlsRequired: true, hasSigningSecret: true });
    expect(zones[0]).not.toHaveProperty('signingSecret');
  });

  it('creates a zone that shows up in the list and the audit log', () => {
    const owner = tokenFor('owner');
    const created = call('cdn', 'POST', '/api/v1/zones', { accessToken: owner, json: { name: 'Docs Site', originUrl: 'https://docs.acme.example' } });
    expect(created.status).toBe(201);
    const zone = created.body as { id: string; slug: string; cacheTtl: number };
    expect(zone).toMatchObject({ slug: 'docs-site', cacheTtl: 3600 });

    const list = call('cdn', 'GET', '/api/v1/zones', { accessToken: owner }).body as { zones: { id: string }[]; total: number };
    expect(list.total).toBe(4);
    expect(list.zones[0].id).toBe(zone.id);

    const audit = call('identity', 'GET', `/api/v1/orgs/${DEMO_ORG_ID}/audit-logs?limit=5`, { accessToken: owner }).body as {
      items: { id: string; action: string; resourceId: string; user: { email: string } }[];
      nextCursor: string | null;
    };
    expect(audit.items[0]).toMatchObject({ action: 'zone.created', resourceId: zone.id, user: { email: 'owner@demo.rivo' } });
    expect(audit.items).toHaveLength(5);
    expect(audit.nextCursor).toBe(audit.items[4].id);
  });

  it('validates zone input with Nest-style message arrays', () => {
    const res = call('cdn', 'POST', '/api/v1/zones', { accessToken: tokenFor('owner'), json: { name: '', originUrl: 'not a url' } });
    expect(res.status).toBe(400);
    expect(Array.isArray((res.body as { message: unknown }).message)).toBe(true);
  });

  it('returns 404 for a zone outside the org', () => {
    expect(call('cdn', 'GET', '/api/v1/zones/00000000-0000-4000-8000-000000000000', { accessToken: tokenFor('owner') }).status).toBe(404);
  });

  it('purges with a 202 pending result that later completes', () => {
    const shop = zoneIdFor('acme-shop');
    const owner = tokenFor('owner');
    const res = call('cdn', 'POST', `/api/v1/zones/${shop}/cache/purge`, { accessToken: owner });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ invalidationId: expect.any(String), status: 'pending' });
    const later = call('cdn', 'GET', `/api/v1/zones/${shop}/cache/invalidations?take=10`, { accessToken: owner, now: Date.now() + 10_000 });
    const { invalidations } = later.body as { invalidations: { id: string; status: string; patterns: string[] }[] };
    expect(invalidations[0]).toMatchObject({ id: (res.body as { invalidationId: string }).invalidationId, status: 'completed', patterns: ['*'] });
  });

  it('creates cache rules ordered by priority', () => {
    const shop = zoneIdFor('acme-shop');
    const dev = tokenFor('dev');
    const created = call('cdn', 'POST', `/api/v1/zones/${shop}/rules`, {
      accessToken: dev,
      json: { pattern: '/img/*', patternType: 'glob', action: 'cache', edgeTtl: 600, queryString: 'strip_all', priority: 99 },
    });
    expect(created.status).toBe(201);
    const { rules, total } = call('cdn', 'GET', `/api/v1/zones/${shop}/rules?take=100`, { accessToken: dev }).body as { rules: { pattern: string }[]; total: number };
    expect(total).toBe(4);
    expect(rules[0].pattern).toBe('/img/*');
  });
});

describe('demo backend: storage', () => {
  it('initiates an upload, accepts the same-origin PUT and marks the object ready', () => {
    const owner = tokenFor('owner');
    const bucket = bucketIdFor('product-images');
    const init = call('storage', 'POST', `/api/v1/buckets/${bucket}/objects/upload`, {
      accessToken: owner,
      json: { key: 'docs/readme.txt', contentType: 'text/plain', size: 11 },
    });
    expect(init.status).toBe(201);
    const { objectId, uploadUrl } = init.body as { objectId: string; uploadUrl: string };
    expect(uploadUrl).toMatch(/^\/api\/demo\/upload\/[A-Za-z0-9_-]+$/);

    const pending = call('storage', 'GET', `/api/v1/buckets/${bucket}/objects`, { accessToken: owner }).body as { objects: { id: string; status: string }[] };
    expect(pending.objects.find((o) => o.id === objectId)!.status).toBe('pending');

    const done = completeUpload(world, uploadUrl.split('/').pop()!, 11);
    expect(done).toMatchObject({ id: objectId, status: 'ready', size: 11 });

    const list = call('storage', 'GET', `/api/v1/buckets/${bucket}/objects`, { accessToken: owner }).body as {
      objects: { id: string; status: string; size: string | null }[];
    };
    expect(list.objects.find((o) => o.id === objectId)).toMatchObject({ status: 'ready', size: '11' });
  });

  it('signs a ready object through a signed-URL website, pointing at the demo route', () => {
    const res = call('storage', 'POST', `/api/v1/buckets/${bucketIdFor('invoices')}/objects/${encodeURIComponent('2026/INV-1001.txt')}/sign`, {
      accessToken: tokenFor('viewer'),
      json: { zoneId: zoneIdFor('media-assets'), expiresIn: 3600 },
      origin: 'https://demo.example.com',
    });
    expect(res.status).toBe(200);
    const { url, expiresAt } = res.body as { url: string; expiresAt: string };
    expect(url.startsWith('https://demo.example.com/api/demo/signed?')).toBe(true);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    const refused = call('storage', 'POST', `/api/v1/buckets/${bucketIdFor('invoices')}/objects/${encodeURIComponent('2026/INV-1001.txt')}/sign`, {
      accessToken: tokenFor('viewer'),
      json: { zoneId: zoneIdFor('acme-shop') },
    });
    expect(refused.status).toBe(409);
  });

  it('refuses to delete a non-empty bucket', () => {
    const res = call('storage', 'DELETE', `/api/v1/buckets/${bucketIdFor('invoices')}`, { accessToken: tokenFor('owner') });
    expect(res).toMatchObject({ status: 409, body: { message: 'Bucket is not empty — delete its objects first' } });
  });
});

describe('demo backend: analytics', () => {
  const day = 24 * 3600_000;
  it.each([
    ['24h', day, 'hour'],
    ['7d', 7 * day, 'day'],
  ])('returns non-empty series for %s', (_label, span, granularity) => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - span).toISOString();
    const qs = `?from=${from}&to=${to}&granularity=${granularity}`;
    const accessToken = tokenFor('viewer');
    const bandwidth = call('analytics', 'GET', `/api/v1/analytics/bandwidth${qs}`, { accessToken }).body as { series: { bucket: number; bytesSent: number }[] };
    expect(bandwidth.series.length).toBeGreaterThan(granularity === 'hour' ? 20 : 6);
    expect(bandwidth.series.every((p) => p.bytesSent > 0 && Number.isInteger(p.bucket))).toBe(true);

    const latency = call('analytics', 'GET', `/api/v1/analytics/latency${qs}`, { accessToken }).body as { series: { p50: number; p95: number; p99: number }[] };
    expect(latency.series.length).toBeGreaterThan(0);
    expect(latency.series.every((p) => p.p50 < p.p95 && p.p95 < p.p99)).toBe(true);

    const overview = call('analytics', 'GET', `/api/v1/analytics/overview${qs}`, { accessToken }).body as { requests: number; hitRatio: number };
    expect(overview.requests).toBeGreaterThan(0);
    expect(overview.hitRatio).toBeGreaterThan(0.9);
    expect(overview.hitRatio).toBeLessThan(0.97);

    for (const name of ['geography', 'status-codes', 'top-paths', 'cache', 'requests']) {
      const res = call('analytics', 'GET', `/api/v1/analytics/${name}${qs}`, { accessToken });
      expect(res.status).toBe(200);
      const list = Object.values(res.body as Record<string, unknown>).find(Array.isArray) as unknown[];
      expect(list.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic and scoped to a zone', () => {
    const accessToken = tokenFor('owner');
    const to = '2026-10-30T12:00:00.000Z';
    const from = '2026-10-29T12:00:00.000Z';
    const path = `/api/v1/analytics/requests?zoneId=${zoneIdFor('acme-blog')}&from=${from}&to=${to}`;
    expect(call('analytics', 'GET', path, { accessToken }).body).toEqual(call('analytics', 'GET', path, { accessToken }).body);
    expect(call('analytics', 'GET', `/api/v1/analytics/requests?zoneId=not-a-uuid`, { accessToken }).status).toBe(400);
  });
});

describe('demo backend: API keys', () => {
  it('returns the raw secret only on create', () => {
    const owner = tokenFor('owner');
    const created = call('identity', 'POST', '/api/v1/api-keys', { accessToken: owner, json: { name: 'deploy bot', permissions: ['zone:read'] } });
    expect(created.status).toBe(201);
    const key = created.body as { id: string; rawKey: string; keyPrefix: string };
    expect(key.rawKey).toMatch(/^rc_live_/);
    expect(key.keyPrefix).toBe(key.rawKey.slice(0, 12));

    const list = call('identity', 'GET', '/api/v1/api-keys', { accessToken: owner }).body as Record<string, unknown>[];
    expect(list.map((k) => k.name)).toEqual(expect.arrayContaining(['CI deploy', 'deploy bot']));
    expect(list.every((k) => !('rawKey' in k))).toBe(true);

    expect(call('identity', 'DELETE', `/api/v1/api-keys/${key.id}`, { accessToken: owner }).status).toBe(200);
    const after = call('identity', 'GET', '/api/v1/api-keys', { accessToken: owner }).body as { id: string }[];
    expect(after.some((k) => k.id === key.id)).toBe(false);
  });
});
