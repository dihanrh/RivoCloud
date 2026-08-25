import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { prisma } from '@rivocloud/db';
import { Client as MinioClient } from 'minio';
import { BucketsService } from './buckets.service.js';
import { physicalBucketName } from './bucket-name.util.js';

const minio = new MinioClient({
  endPoint: '127.0.0.1',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER ?? 'rivocloud',
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'rivocloud_dev_password',
});

async function seedOrg() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Bucket Owner' } });
  return prisma.organization.create({ data: { name: 'Bucket Org', slug: `bucket-org-${randomUUID()}`, ownerId: user.id } });
}

describe('BucketsService', () => {
  const service = new BucketsService(prisma, minio);

  beforeEach(async () => {
    await prisma.storageObject.deleteMany();
    await prisma.bucket.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a bucket in Postgres and a matching physical bucket in MinIO', async () => {
    const org = await seedOrg();
    const bucket = await service.create(org.id, { name: 'My Photos' });

    expect(bucket.name).toBe('My Photos');
    expect(bucket.region).toBe('eu-central');
    expect(bucket.public).toBe(false);

    const exists = await minio.bucketExists(physicalBucketName(bucket.id));
    expect(exists).toBe(true);
  });

  it('allows the same name to be reused in a different org (no global uniqueness on name)', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const bucketA = await service.create(orgA.id, { name: 'Shared Name' });
    const bucketB = await service.create(orgB.id, { name: 'Shared Name' });

    expect(bucketA.id).not.toBe(bucketB.id);
    expect(await minio.bucketExists(physicalBucketName(bucketA.id))).toBe(true);
    expect(await minio.bucketExists(physicalBucketName(bucketB.id))).toBe(true);
  });

  it('lists only the calling org buckets', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await service.create(orgA.id, { name: 'A1' });
    await service.create(orgB.id, { name: 'B1' });

    const page = await service.list(orgA.id, 0, 50);
    expect(page.buckets).toHaveLength(1);
    expect(page.buckets[0].name).toBe('A1');
  });

  it('rejects getForOrg/update/remove on a bucket belonging to a different org', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const bucket = await service.create(orgA.id, { name: 'A1' });

    await expect(service.getForOrg(orgB.id, bucket.id)).rejects.toThrow(NotFoundException);
    await expect(service.update(orgB.id, bucket.id, { public: true })).rejects.toThrow(NotFoundException);
    await expect(service.remove(orgB.id, bucket.id)).rejects.toThrow(NotFoundException);
  });

  it('updates only the fields provided', async () => {
    const org = await seedOrg();
    const bucket = await service.create(org.id, { name: 'A1' });
    const updated = await service.update(org.id, bucket.id, { public: true });
    expect(updated.public).toBe(true);
    expect(updated.name).toBe('A1');
  });

  it('removes an empty bucket from both Postgres and MinIO', async () => {
    const org = await seedOrg();
    const bucket = await service.create(org.id, { name: 'A1' });
    await service.remove(org.id, bucket.id);

    await expect(service.getForOrg(org.id, bucket.id)).rejects.toThrow(NotFoundException);
    expect(await minio.bucketExists(physicalBucketName(bucket.id))).toBe(false);
  });

  it('refuses to remove a bucket that still has objects', async () => {
    const org = await seedOrg();
    const bucket = await service.create(org.id, { name: 'A1' });
    await prisma.storageObject.create({
      data: {
        bucketId: bucket.id,
        key: 'still-here.txt',
        storagePath: `${physicalBucketName(bucket.id)}/still-here.txt/v1`,
      },
    });

    await expect(service.remove(org.id, bucket.id)).rejects.toThrow(ConflictException);
  });
});
