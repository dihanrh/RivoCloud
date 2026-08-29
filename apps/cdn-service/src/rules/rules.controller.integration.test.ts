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

describe('RulesController', () => {
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
    await prisma.cacheRule.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedZoneAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    const zone = await prisma.pullZone.create({
      data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
    });
    return zone;
  }

  it('creates and lists a cache rule', async () => {
    const zone = await seedZoneAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/api/*', action: 'bypass', edgeTtl: 0 });
    expect(created.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever');
    expect(list.status).toBe(200);
    expect(list.body.rules).toHaveLength(1);
  });

  it('rejects a viewer trying to create a rule', async () => {
    const zone = await seedZoneAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/api/*' });
    expect(response.status).toBe(403);
  });

  it('rejects whitelist query mode without a queryWhitelist', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/search', queryString: 'whitelist' });
    expect(response.status).toBe(400);
  });

  it('updates and deletes a rule', async () => {
    const zone = await seedZoneAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/a' });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/zones/${zone.id}/rules/${created.body.id}`)
      .set('Authorization', 'Bearer whatever')
      .send({ edgeTtl: 120 });
    expect(updated.status).toBe(200);
    expect(updated.body.edgeTtl).toBe(120);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/zones/${zone.id}/rules/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);
  });

  it('reorders rules', async () => {
    const zone = await seedZoneAndAuth('owner');
    const a = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/a' });
    const b = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/b' });

    const reordered = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules/reorder`)
      .set('Authorization', 'Bearer whatever')
      .send({ order: [b.body.id, a.body.id] });
    expect(reordered.status).toBe(201);
  });
});
