import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@rivocloud/db';
import type { Client as MinioClient } from 'minio';
import { PRISMA } from '../prisma/prisma.module.js';
import { MINIO } from '../minio/minio.module.js';
import { BucketsService } from '../buckets/buckets.service.js';
import { physicalBucketName } from '../buckets/bucket-name.util.js';
import { EventsService } from '../events/events.service.js';
import { bucketIdFromPhysicalName, decodeMinioObjectKey, splitKeyAndVersion } from './object-key.util.js';
import type { InitiateUploadDto } from './dto/initiate-upload.dto.js';
import type { ListObjectsDto } from './dto/list-objects.dto.js';

const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;

@Injectable()
export class ObjectsService {
  private readonly logger = new Logger(ObjectsService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(MINIO) private readonly minio: MinioClient,
    private readonly buckets: BucketsService,
    private readonly events: EventsService,
  ) {}

  async initiateUpload(orgId: string, bucketId: string, dto: InitiateUploadDto) {
    await this.buckets.getForOrg(orgId, bucketId);
    const versionId = randomUUID();
    const physicalName = physicalBucketName(bucketId);
    const minioObjectKey = `${dto.key}/${versionId}`;
    const object = await this.db.storageObject.create({
      data: {
        bucketId,
        key: dto.key,
        versionId,
        contentType: dto.contentType ?? 'application/octet-stream',
        size: dto.size !== undefined ? BigInt(dto.size) : null,
        storagePath: `${physicalName}/${minioObjectKey}`,
        status: 'pending',
      },
    });
    const uploadUrl = await this.minio.presignedPutObject(physicalName, minioObjectKey, PRESIGNED_UPLOAD_TTL_SECONDS);
    return { objectId: object.id, uploadUrl };
  }

  async list(orgId: string, bucketId: string, opts: ListObjectsDto) {
    await this.buckets.getForOrg(orgId, bucketId);
    const where = {
      bucketId,
      isLatest: true,
      status: { not: 'deleted' },
      ...(opts.prefix && { key: { startsWith: opts.prefix } }),
    };
    const [objects, total] = await Promise.all([
      this.db.storageObject.findMany({ where, skip: opts.skip ?? 0, take: opts.take ?? 50, orderBy: { createdAt: 'desc' } }),
      this.db.storageObject.count({ where }),
    ]);
    return { objects, total };
  }

  async getForOrg(orgId: string, bucketId: string, key: string) {
    await this.buckets.getForOrg(orgId, bucketId);
    return this.findLatest(bucketId, key);
  }

  async remove(orgId: string, bucketId: string, key: string): Promise<void> {
    await this.buckets.getForOrg(orgId, bucketId);
    const object = await this.findLatest(bucketId, key);

    await this.db.storageObject.update({ where: { id: object.id }, data: { status: 'deleted' } });

    try {
      const minioObjectKey = `${object.key}/${object.versionId}`;
      await this.minio.removeObject(physicalBucketName(bucketId), minioObjectKey);
    } catch (error) {
      // Best-effort: the metadata row (already marked deleted, above) is the
      // source of truth every other read in this service checks. A failed
      // physical removal here just means bytes linger in MinIO a bit longer
      // — documented, accepted window (Design Decision 6).
      this.logger.warn(`failed to remove MinIO object for ${bucketId}/${key}: ${error}`);
    }
  }

  private async findLatest(bucketId: string, key: string) {
    const object = await this.db.storageObject.findFirst({ where: { bucketId, key, isLatest: true } });
    if (!object || object.status === 'deleted') {
      throw new NotFoundException('Object not found');
    }
    return object;
  }

  async markUploaded(record: { s3: { bucket: { name: string }; object: { key: string; size: number; eTag: string } } }): Promise<void> {
    const bucketId = bucketIdFromPhysicalName(record.s3.bucket.name);
    const rawKey = decodeMinioObjectKey(record.s3.object.key);
    const [key, versionId] = splitKeyAndVersion(rawKey);

    const object = await this.db.storageObject.findFirst({ where: { bucketId, key, versionId } });
    if (!object) {
      return; // no matching pending upload — ignore (defensive; shouldn't happen for our own uploads)
    }

    await this.db.storageObject.update({
      where: { id: object.id },
      data: { status: 'ready', size: BigInt(record.s3.object.size), etag: record.s3.object.eTag },
    });

    const bucket = await this.db.bucket.findUnique({ where: { id: bucketId } });
    if (bucket) {
      await this.events.publish('object.uploaded', { bucketId, key, orgId: bucket.orgId });
    }
  }
}
