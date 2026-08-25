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

describe('BucketsController', () => {
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
    await prisma.storageObject.deleteMany();
    await prisma.bucket.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedOrgAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Bucket Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    return org;
  }

  it('rejects a request with no credential', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/buckets');
    expect(response.status).toBe(401);
  });

  it('creates a bucket for the caller org', async () => {
    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Bucket' });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('My Bucket');
  });

  it('rejects a viewer trying to create a bucket', async () => {
    await seedOrgAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Bucket' });
    expect(response.status).toBe(403);
  });

  it('does not leak a bucket across organizations', async () => {
    await seedOrgAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'A1' });

    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(404);
  });

  it('updates and deletes an empty bucket', async () => {
    await seedOrgAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'A1' });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/buckets/${created.body.id}`)
      .set('Authorization', 'Bearer whatever')
      .send({ public: true });
    expect(updated.status).toBe(200);
    expect(updated.body.public).toBe(true);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/buckets/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);

    const getAfterDelete = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(getAfterDelete.status).toBe(404);
  });
});
