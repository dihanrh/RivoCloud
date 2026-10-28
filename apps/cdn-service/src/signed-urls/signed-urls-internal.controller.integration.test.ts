import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { encryptSecret } from '../signing/secret-box.js';
import { signPath } from '../signing/url-signer.js';

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? '';
const ENCRYPTION_KEY = process.env.ZONE_SECRET_ENCRYPTION_KEY ?? '';
const ROOT_DOMAIN = process.env.CDN_ROOT_DOMAIN ?? 'cdn.rivocloud.dev';
const SIGNING_SECRET = 'f'.repeat(64);

describe('SignedUrlsInternalController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.zoneDomain.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedZone(opts: { signedUrlsRequired?: boolean; withSecret?: boolean } = {}) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    const zone = await prisma.pullZone.create({
      data: {
        orgId: org.id,
        name: 'Private',
        slug: 'private',
        originUrl: 'https://origin.example.com',
        signedUrlsRequired: opts.signedUrlsRequired ?? true,
        signingSecret: (opts.withSecret ?? true) ? encryptSecret(SIGNING_SECRET, ENCRYPTION_KEY) : null,
      },
    });
    return { org, zone };
  }

  function sign(zoneId: string, body: object, secret: string | null = INTERNAL_SECRET) {
    const req = request(app.getHttpServer()).post(`/internal/zones/${zoneId}/signed-urls`);
    if (secret !== null) req.set('X-Internal-Secret', secret);
    return req.send(body);
  }

  const future = () => Math.floor(Date.now() / 1000) + 900;

  it('rejects a request without the internal secret', async () => {
    const { org, zone } = await seedZone();
    expect((await sign(zone.id, { orgId: org.id, path: '/a.txt', expires: future() }, null)).status).toBe(401);
    expect((await sign(zone.id, { orgId: org.id, path: '/a.txt', expires: future() }, 'wrong-secret-value')).status).toBe(401);
  });

  it('signs a path on the zone host with a signature the edge can verify', async () => {
    const { org, zone } = await seedZone();
    const expires = future();
    const response = await sign(zone.id, { orgId: org.id, path: '/reports/q3 2026.pdf', expires });

    expect(response.status).toBe(200);
    const url = new URL(response.body.url);
    expect(url.host).toBe(`private-${zone.id.slice(0, 8)}.${ROOT_DOMAIN}`);
    expect(url.pathname).toBe('/reports/q3%202026.pdf');
    expect(url.searchParams.get('expires')).toBe(String(expires));
    expect(url.searchParams.get('sig')).toBe(signPath(SIGNING_SECRET, '/reports/q3 2026.pdf', expires));
  });

  it("uses the zone's active custom domain over https when it has one", async () => {
    const { org, zone } = await seedZone();
    await prisma.zoneDomain.create({ data: { zoneId: zone.id, domain: `pending-${randomUUID()}.example.com` } });
    const active = `cdn-${randomUUID()}.example.com`;
    await prisma.zoneDomain.create({ data: { zoneId: zone.id, domain: active, sslStatus: 'active' } });

    const response = await sign(zone.id, { orgId: org.id, path: '/a.txt', expires: future() });
    expect(response.status).toBe(200);
    expect(response.body.url.startsWith(`https://${active}/a.txt?`)).toBe(true);
  });

  it("404s for another org's zone", async () => {
    const { zone } = await seedZone();
    const { org: otherOrg } = await seedZone();
    expect((await sign(zone.id, { orgId: otherOrg.id, path: '/a.txt', expires: future() })).status).toBe(404);
  });

  it('409s when the zone does not require signed URLs', async () => {
    const { org, zone } = await seedZone({ signedUrlsRequired: false });
    expect((await sign(zone.id, { orgId: org.id, path: '/a.txt', expires: future() })).status).toBe(409);
  });

  it('409s when the zone has no signing secret', async () => {
    const { org, zone } = await seedZone({ withSecret: false });
    expect((await sign(zone.id, { orgId: org.id, path: '/a.txt', expires: future() })).status).toBe(409);
  });

  it('400s for an expiry in the past or a relative path', async () => {
    const { org, zone } = await seedZone();
    expect((await sign(zone.id, { orgId: org.id, path: '/a.txt', expires: 1000 })).status).toBe(400);
    expect((await sign(zone.id, { orgId: org.id, path: 'a.txt', expires: future() })).status).toBe(400);
  });
});
