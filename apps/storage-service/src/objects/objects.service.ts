import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@rivocloud/db';
import type { Client as MinioClient } from 'minio';
import { PRISMA } from '../prisma/prisma.module.js';
import { MINIO } from '../minio/minio.module.js';
import { BucketsService } from '../buckets/buckets.service.js';
import { physicalBucketName } from '../buckets/bucket-name.util.js';
import type { InitiateUploadDto } from './dto/initiate-upload.dto.js';
import type { ListObjectsDto } from './dto/list-objects.dto.js';

const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;

@Injectable()
export class ObjectsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(MINIO) private readonly minio: MinioClient,
    private readonly buckets: BucketsService,
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

  private async findLatest(bucketId: string, key: string) {
    const object = await this.db.storageObject.findFirst({ where: { bucketId, key, isLatest: true } });
    if (!object || object.status === 'deleted') {
      throw new NotFoundException('Object not found');
    }
    return object;
  }
}
