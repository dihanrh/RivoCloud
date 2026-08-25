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
    if (!this.nextAuth) throw new Error('not set');
    return this.nextAuth;
  }
  async verifyApiKey(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('not set');
    return this.nextAuth;
  }
}

describe('ObjectsController', () => {
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

  async function seedOrgBucketAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role: 'owner' };
    const bucketRes = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'Bucket' });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    return { org, bucketId: bucketRes.body.id };
  }

  it('initiates an upload and returns a presigned URL', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'hello.txt', contentType: 'text/plain' });

    expect(response.status).toBe(201);
    expect(response.body.uploadUrl).toMatch(/^http/);
    expect(typeof response.body.objectId).toBe('string');
  });

  it('rejects a viewer trying to initiate an upload', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'hello.txt' });
    expect(response.status).toBe(403);
  });

  it('lists and gets object metadata', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('owner');
    await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'hello.txt' });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${bucketId}/objects`)
      .set('Authorization', 'Bearer whatever');
    expect(list.status).toBe(200);
    expect(list.body.objects).toHaveLength(1);

    const get = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${bucketId}/objects/hello.txt`)
      .set('Authorization', 'Bearer whatever');
    expect(get.status).toBe(200);
    expect(get.body.status).toBe('pending');
  });

  it('deletes an object', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('admin');
    await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'gone.txt' });

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/buckets/${bucketId}/objects/gone.txt`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);

    const getAfterDelete = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${bucketId}/objects/gone.txt`)
      .set('Authorization', 'Bearer whatever');
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects a developer with only storage:read from deleting', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .delete(`/api/v1/buckets/${bucketId}/objects/whatever.txt`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(403);
  });
});
