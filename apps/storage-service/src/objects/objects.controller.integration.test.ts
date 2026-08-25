import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { IdentityClient } from '../auth/identity-client.js';
import type { CombinedAuthContext } from '../auth/auth-context.decorator.js';

const WEBHOOK_TOKEN = process.env.MINIO_WEBHOOK_AUTH_TOKEN ?? 'dev_minio_webhook_token_change_me';

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

  // Regression test for the bug caught by Stage 5's manual e2e verification:
  // GET-ing an object whose upload has actually completed (a real MinIO PUT,
  // simulated here via the same webhook endpoint MinIO calls) 500'd, because
  // NestJS's JSON.stringify-based response serialization can't handle the
  // raw Prisma row's BigInt size. This drives the real HTTP GET route end to
  // end — auth guard, controller, service, serialization — the same path a
  // real client hits, and is the most direct proof the 500 is gone.
  it('GETs an object with a completed upload without a 500, returning size as a string', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('owner');
    const upload = await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'done.txt' });

    const pending = await prisma.storageObject.findUnique({ where: { id: upload.body.objectId } });
    const physicalName = `rc-${bucketId}`;
    const webhookResponse = await request(app.getHttpServer())
      .post('/internal/storage/minio-webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
      .send({
        Records: [
          {
            eventName: 's3:ObjectCreated:Put',
            s3: {
              bucket: { name: physicalName },
              object: { key: `done.txt%2F${pending!.versionId}`, size: 555, eTag: 'etag-done' },
            },
          },
        ],
      });
    expect(webhookResponse.status).toBe(201);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${bucketId}/objects/done.txt`)
      .set('Authorization', 'Bearer whatever');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(typeof response.body.size).toBe('string');
    expect(response.body.size).toBe('555');
  });
});
