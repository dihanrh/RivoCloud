import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { BucketsService } from '../buckets/buckets.service.js';
import { EventsService } from '../events/events.service.js';

// This test simulates MinIO's webhook notification via a direct HTTP POST
// (see minioNotificationBody below) rather than performing a real MinIO PUT,
// so no MinioClient is needed here.
const WEBHOOK_TOKEN = process.env.MINIO_WEBHOOK_AUTH_TOKEN ?? 'dev_minio_webhook_token_change_me';

function minioNotificationBody(bucketPhysicalName: string, minioObjectKey: string, size: number, etag: string) {
  return {
    Records: [
      {
        eventName: 's3:ObjectCreated:Put',
        s3: {
          bucket: { name: bucketPhysicalName },
          object: { key: minioObjectKey.replace(/\//g, '%2F'), size, eTag: etag },
        },
      },
    ],
  };
}

describe('MinioWebhookController', () => {
  let app: INestApplication;
  let events: EventsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    events = app.get(EventsService);
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

  it('rejects a webhook call with the wrong auth token', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/storage/minio-webhook')
      .set('Authorization', 'Bearer wrong-token')
      .send({ Records: [] });
    expect(response.status).toBe(401);
  });

  it('marks a pending object ready and publishes object.uploaded', async () => {
    const buckets = app.get(BucketsService);
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    const bucket = await buckets.create(org.id, { name: 'Webhook Bucket' });

    // Seed a pending object row directly (mirrors what initiateUpload does)
    const physicalName = `rc-${bucket.id}`;
    const versionId = randomUUID();
    const object = await prisma.storageObject.create({
      data: {
        bucketId: bucket.id,
        key: 'hello.txt',
        versionId,
        storagePath: `${physicalName}/hello.txt/${versionId}`,
        status: 'pending',
      },
    });

    const response = await request(app.getHttpServer())
      .post('/internal/storage/minio-webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
      .send(minioNotificationBody(physicalName, `hello.txt/${versionId}`, 42, 'abc123etag'));

    expect(response.status).toBe(201);

    const updated = await prisma.storageObject.findUnique({ where: { id: object.id } });
    expect(updated!.status).toBe('ready');
    expect(updated!.size).toBe(42n);
    expect(updated!.etag).toBe('abc123etag');

    expect(events.getLastPublished('object.uploaded')).toEqual({ bucketId: bucket.id, key: 'hello.txt', orgId: org.id });
  });

  it('ignores a notification for an object it has no record of', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/storage/minio-webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
      .send(minioNotificationBody(`rc-${randomUUID()}`, `nope.txt/${randomUUID()}`, 1, 'x'));
    expect(response.status).toBe(201);
  });

  // Regression test: a physical MinIO bucket is subscribed to ALL
  // ObjectCreatedPut events, not just ones from this service's own
  // presigned-upload flow — so a notification can arrive with a bucket name
  // that isn't shaped like "rc-<uuid>" and/or an object key with no "/" in it
  // at all (e.g. something placed via `mc cp` directly, or a future feature).
  // splitKeyAndVersion() used to corrupt a no-slash key instead of failing
  // cleanly, and markUploaded() had no guard against a non-UUID bucket/version
  // id reaching the Prisma query — both previously risked a 500 here instead
  // of a clean no-op ignore.
  it('ignores a malformed notification (unrecognized bucket name, no-slash key) without erroring', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/storage/minio-webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
      .send(minioNotificationBody('rc-unknown-bucket-id', 'not-a-versioned-key', 1, 'x'));
    expect(response.status).toBe(201);
  });
});
