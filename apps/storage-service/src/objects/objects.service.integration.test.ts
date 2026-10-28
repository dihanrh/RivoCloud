import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { prisma } from '@rivocloud/db';
import { Client as MinioClient } from 'minio';
import { BucketsService } from '../buckets/buckets.service.js';
import { physicalBucketName } from '../buckets/bucket-name.util.js';
import { ObjectsService } from './objects.service.js';
import { EventsService } from '../events/events.service.js';
import type { CdnClient, SignUrlRequest } from '../cdn/cdn-client.js';

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

// Mirrors minio-webhook.controller.integration.test.ts's minioNotificationBody
// helper, but shaped as the single `record` markUploaded() takes directly
// (rather than the full webhook POST body), since these tests drive
// ObjectsService directly instead of going through HTTP.
function minioNotificationRecord(bucketPhysicalName: string, minioObjectKey: string, size: number, etag: string) {
  return {
    s3: {
      bucket: { name: bucketPhysicalName },
      object: { key: minioObjectKey.replace(/\//g, '%2F'), size, eTag: etag },
    },
  };
}

// Stands in for the CDN Service's internal signing endpoint, which has its
// own integration tests in apps/cdn-service.
class FakeCdnClient {
  calls: Array<{ zoneId: string; body: SignUrlRequest }> = [];
  async signUrl(zoneId: string, body: SignUrlRequest) {
    this.calls.push({ zoneId, body });
    return { url: `https://zone.cdn.test${body.path}?expires=${body.expires}&sig=fakesig` };
  }
}

describe('ObjectsService', () => {
  const buckets = new BucketsService(prisma, minio);
  const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
  const cdn = new FakeCdnClient();
  const service = new ObjectsService(prisma, minio, buckets, events, cdn as unknown as CdnClient);

  afterAll(async () => {
    await events.onModuleDestroy();
  });

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

  // Regression test for the bug caught by Stage 5's manual e2e verification:
  // once markUploaded() sets a real (non-null) BigInt size, getForOrg() must
  // not hand that BigInt straight back — NestJS serializes responses with
  // JSON.stringify, which throws "Do not know how to serialize a BigInt" for
  // any raw Prisma row whose size is set. Every other test in this file only
  // ever reads an object while it's still pending (size still null), which is
  // exactly why this was never caught before real end-to-end testing.
  it('returns object size as a numeric string (not a BigInt) once the upload has completed', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    const { objectId } = await service.initiateUpload(org.id, bucket.id, { key: 'real.txt' });
    const pending = await prisma.storageObject.findUnique({ where: { id: objectId } });

    await service.markUploaded(
      minioNotificationRecord(physicalBucketName(bucket.id), `real.txt/${pending!.versionId}`, 12345, 'etag-real'),
    );

    const object = await service.getForOrg(org.id, bucket.id, 'real.txt');
    expect(object.status).toBe('ready');
    expect(typeof object.size).toBe('string');
    expect(object.size).toBe('12345');
  });

  it('includes a numeric-string size for a completed upload in list() results', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    const { objectId } = await service.initiateUpload(org.id, bucket.id, { key: 'listed.txt' });
    const pending = await prisma.storageObject.findUnique({ where: { id: objectId } });

    await service.markUploaded(
      minioNotificationRecord(physicalBucketName(bucket.id), `listed.txt/${pending!.versionId}`, 98765, 'etag-listed'),
    );

    const page = await service.list(org.id, bucket.id, { skip: 0, take: 50 });
    const listed = page.objects.find((o) => o.key === 'listed.txt');
    expect(listed).toBeDefined();
    expect(typeof listed!.size).toBe('string');
    expect(listed!.size).toBe('98765');
  });

  // Regression test: re-uploading the same key used to leave two rows both
  // marked isLatest: true (initiateUpload never demoted the prior row), so
  // which one findLatest()/getForOrg() returned was arbitrary. The fix wraps
  // the demote + create in a transaction.
  it('demotes the previous isLatest row when a key is re-uploaded (overwrite)', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'overwrite.txt' });
    const second = await service.initiateUpload(org.id, bucket.id, { key: 'overwrite.txt' });

    const rows = await prisma.storageObject.findMany({ where: { bucketId: bucket.id, key: 'overwrite.txt' } });
    expect(rows).toHaveLength(2);
    const latestRows = rows.filter((r) => r.isLatest);
    expect(latestRows).toHaveLength(1);
    expect(latestRows[0]!.id).toBe(second.objectId);

    const current = await service.getForOrg(org.id, bucket.id, 'overwrite.txt');
    expect(current.id).toBe(second.objectId);
  });

  // Regression test: markUploaded() used to match on {bucketId, key, versionId}
  // with no status check, so a MinIO webhook arriving after the object was
  // soft-deleted (client's PUT completed within the presigned URL's TTL, after
  // the DELETE) would resurrect it as 'ready'.
  it('does not resurrect a soft-deleted object when a late markUploaded notification arrives', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    const { objectId } = await service.initiateUpload(org.id, bucket.id, { key: 'late-upload.txt' });
    const pending = await prisma.storageObject.findUnique({ where: { id: objectId } });

    await service.remove(org.id, bucket.id, 'late-upload.txt');

    await service.markUploaded(
      minioNotificationRecord(physicalBucketName(bucket.id), `late-upload.txt/${pending!.versionId}`, 555, 'etag-late'),
    );

    const after = await prisma.storageObject.findUnique({ where: { id: objectId } });
    expect(after!.status).toBe('deleted');
  });

  describe('sign', () => {
    const zoneId = randomUUID();

    async function seedReadyObject(key: string) {
      const { org, bucket } = await seedOrgAndBucket(buckets);
      const { objectId } = await service.initiateUpload(org.id, bucket.id, { key });
      await prisma.storageObject.update({ where: { id: objectId }, data: { status: 'ready', size: BigInt(5) } });
      return { org, bucket };
    }

    beforeEach(() => {
      cdn.calls = [];
    });

    it('asks the CDN Service to sign "/{key}" with a 15-minute default expiry', async () => {
      const { org, bucket } = await seedReadyObject('reports/q3.pdf');
      const before = Math.floor(Date.now() / 1000);
      const result = await service.sign(org.id, bucket.id, 'reports/q3.pdf', { zoneId });

      expect(cdn.calls).toHaveLength(1);
      expect(cdn.calls[0]!.zoneId).toBe(zoneId);
      expect(cdn.calls[0]!.body.orgId).toBe(org.id);
      expect(cdn.calls[0]!.body.path).toBe('/reports/q3.pdf');
      expect(cdn.calls[0]!.body.expires - before).toBeGreaterThanOrEqual(900);
      expect(cdn.calls[0]!.body.expires - before).toBeLessThanOrEqual(901);
      expect(result.url).toBe(`https://zone.cdn.test/reports/q3.pdf?expires=${cdn.calls[0]!.body.expires}&sig=fakesig`);
      expect(result.expiresAt).toBe(new Date(cdn.calls[0]!.body.expires * 1000).toISOString());
    });

    it('honors expiresIn and appends the download modifiers outside the signature', async () => {
      const { org, bucket } = await seedReadyObject('a.txt');
      const result = await service.sign(org.id, bucket.id, 'a.txt', { zoneId, expiresIn: 3600, download: true, filename: 'my report.txt' });

      const url = new URL(result.url);
      expect(url.searchParams.get('sig')).toBe('fakesig');
      expect(url.searchParams.get('download')).toBe('1');
      expect(url.searchParams.get('filename')).toBe('my report.txt');
      expect(cdn.calls[0]!.body.expires - Math.floor(Date.now() / 1000)).toBeGreaterThan(3590);
    });

    it('refuses to sign an upload that has not completed', async () => {
      const { org, bucket } = await seedOrgAndBucket(buckets);
      await service.initiateUpload(org.id, bucket.id, { key: 'pending.txt' });
      await expect(service.sign(org.id, bucket.id, 'pending.txt', { zoneId })).rejects.toThrow(ConflictException);
      expect(cdn.calls).toHaveLength(0);
    });

    it('404s for an unknown key or a bucket belonging to a different org', async () => {
      const { org, bucket } = await seedReadyObject('a.txt');
      const { org: otherOrg } = await seedOrgAndBucket(buckets, 'Other Bucket');
      await expect(service.sign(org.id, bucket.id, 'missing.txt', { zoneId })).rejects.toThrow(NotFoundException);
      await expect(service.sign(otherOrg.id, bucket.id, 'a.txt', { zoneId })).rejects.toThrow(NotFoundException);
      expect(cdn.calls).toHaveLength(0);
    });
  });
});
