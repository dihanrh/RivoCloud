import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { IdentityClient } from '../auth/identity-client.js';
import type { CombinedAuthContext } from '../auth/auth-context.decorator.js';

class FakeIdentityClient {
  nextAuth: CombinedAuthContext | null = null;
  async verifyToken(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('FakeIdentityClient.nextAuth not set');
    return this.nextAuth;
  }
  async verifyApiKey(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('FakeIdentityClient.nextAuth not set');
    return this.nextAuth;
  }
}

describe('InvalidationsController', () => {
  let app: INestApplication;
  let fakeIdentity: FakeIdentityClient;

  beforeAll(async () => {
    fakeIdentity = new FakeIdentityClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityClient)
      .useValue(fakeIdentity)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.cacheInvalidation.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedZoneAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    return prisma.pullZone.create({
      data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
    });
  }

  it('creates an invalidation and returns pending', async () => {
    const zone = await seedZoneAndAuth('developer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({ patterns: ['/logo.png'] });
    expect(response.status).toBe(202);
    expect(response.body.status).toBe('pending');
  });

  it('rejects a viewer trying to invalidate', async () => {
    const zone = await seedZoneAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({ patterns: ['/logo.png'] });
    expect(response.status).toBe(403);
  });

  it('rejects an invalidation with neither patterns nor tags', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({});
    expect(response.status).toBe(400);
  });

  it('purges the whole zone', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/purge`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(202);
  });

  it('rejects an invalidation with more than 100 patterns', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({ patterns: Array.from({ length: 101 }, (_, i) => `/p${i}`) });
    expect(response.status).toBe(400);
  });

  it('lists and fetches invalidation history', async () => {
    const zone = await seedZoneAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({ patterns: ['/a'] });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zone.id}/cache/invalidations`)
      .set('Authorization', 'Bearer whatever');
    expect(list.body.invalidations).toHaveLength(1);

    const one = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zone.id}/cache/invalidations/${created.body.invalidationId}`)
      .set('Authorization', 'Bearer whatever');
    expect(one.status).toBe(200);
  });
});
