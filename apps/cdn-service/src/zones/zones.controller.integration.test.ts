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

describe('ZonesController', () => {
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
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedOrgAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Zone Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    return org;
  }

  it('rejects a request with no credential', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/zones');
    expect(response.status).toBe(401);
  });

  it("creates a zone for the caller's org and hides signingSecret", async () => {
    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Blog', originUrl: 'https://api.example.com' });

    expect(response.status).toBe(201);
    expect(response.body.slug).toBe('my-blog');
    expect(response.body).not.toHaveProperty('signingSecret');
  });

  it('rejects a viewer trying to create a zone', async () => {
    await seedOrgAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Blog', originUrl: 'https://api.example.com' });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid originUrl', async () => {
    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Blog', originUrl: 'not-a-url' });
    expect(response.status).toBe(400);
  });

  it('does not leak a zone across organizations', async () => {
    await seedOrgAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'A1', originUrl: 'https://a1.example.com' });

    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .get(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(404);
  });

  it('updates and deletes a zone', async () => {
    await seedOrgAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'A1', originUrl: 'https://a1.example.com' });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever')
      .send({ cacheTtl: 60 });
    expect(updated.status).toBe(200);
    expect(updated.body.cacheTtl).toBe(60);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);

    const getAfterDelete = await request(app.getHttpServer())
      .get(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(getAfterDelete.status).toBe(404);
  });

  it('enables signed URLs and rotates the secret without ever returning it', async () => {
    await seedOrgAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'Private', originUrl: 'https://private.example.com' });

    const enabled = await request(app.getHttpServer())
      .patch(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever')
      .send({ signedUrlsRequired: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({ signedUrlsRequired: true, hasSigningSecret: true });
    expect(enabled.body).not.toHaveProperty('signingSecret');

    const rotated = await request(app.getHttpServer())
      .post(`/api/v1/zones/${created.body.id}/signing-secret/rotate`)
      .set('Authorization', 'Bearer whatever');
    expect(rotated.status).toBe(201);
    expect(rotated.body.hasSigningSecret).toBe(true);
    expect(rotated.body).not.toHaveProperty('signingSecret');
  });

  it('rejects a viewer trying to rotate the signing secret', async () => {
    const org = await seedOrgAndAuth('owner');
    const zone = await prisma.pullZone.create({ data: { orgId: org.id, name: 'Z', slug: 'z', originUrl: 'https://z.example.com' } });
    fakeIdentity.nextAuth = { ...fakeIdentity.nextAuth!, role: 'viewer' };
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/signing-secret/rotate`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(403);
  });
});
