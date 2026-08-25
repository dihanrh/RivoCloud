import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma } from '@rivocloud/db';
import { Client as MinioClient } from 'minio';
import { BucketsService } from '../buckets/buckets.service.js';
import { ObjectsService } from './objects.service.js';
import { EventsService } from '../events/events.service.js';

const minio = new MinioClient({
  endPoint: '127.0.0.1',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER ?? 'rivocloud',
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'rivocloud_dev_password',
});

async function seedOrgAndBucket(buckets: BucketsService, name = 'Test Bucket') {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  const bucket = await buckets.create(org.id, { name });
  return { org, bucket };
}

describe('ObjectsService', () => {
  const buckets = new BucketsService(prisma, minio);
  const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
  const service = new ObjectsService(prisma, minio, buckets, events);

  beforeEach(async () => {
    await prisma.storageObject.deleteMany();
    await prisma.bucket.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('inserts a pending object row and returns a presigned PUT URL', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    const result = await service.initiateUpload(org.id, bucket.id, { key: 'hello.txt', contentType: 'text/plain' });

    expect(result.uploadUrl).toMatch(/^http/);
    const object = await prisma.storageObject.findUnique({ where: { id: result.objectId } });
    expect(object).not.toBeNull();
    expect(object!.status).toBe('pending');
    expect(object!.key).toBe('hello.txt');
    expect(object!.contentType).toBe('text/plain');
  });

  it('rejects initiating an upload into a bucket belonging to a different org', async () => {
    const { bucket } = await seedOrgAndBucket(buckets);
    const otherUser = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Other' } });
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Org', slug: `other-org-${randomUUID()}`, ownerId: otherUser.id },
    });

    await expect(
      service.initiateUpload(otherOrg.id, bucket.id, { key: 'hello.txt' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists objects for a bucket, newest first, only latest versions', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'a.txt' });
    await service.initiateUpload(org.id, bucket.id, { key: 'b.txt' });

    const page = await service.list(org.id, bucket.id, { skip: 0, take: 50 });
    expect(page.objects).toHaveLength(2);
    expect(page.objects.every((o) => o.isLatest)).toBe(true);
  });

  it('gets object metadata by key', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'a.txt' });

    const object = await service.getForOrg(org.id, bucket.id, 'a.txt');
    expect(object.key).toBe('a.txt');
    expect(object.status).toBe('pending');
  });

  it('throws NotFoundException getting an unknown key', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await expect(service.getForOrg(org.id, bucket.id, 'missing.txt')).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes an object and best-effort removes it from MinIO', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'to-delete.txt' });

    await service.remove(org.id, bucket.id, 'to-delete.txt');

    await expect(service.getForOrg(org.id, bucket.id, 'to-delete.txt')).rejects.toThrow(NotFoundException);
  });

  it('rejects deleting an object belonging to a different org', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'mine.txt' });

    const otherUser = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Other' } });
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Org', slug: `other-org-${randomUUID()}`, ownerId: otherUser.id },
    });

    await expect(service.remove(otherOrg.id, bucket.id, 'mine.txt')).rejects.toThrow(NotFoundException);
  });
});
