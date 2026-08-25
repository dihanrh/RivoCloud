import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@rivocloud/db';
import type { PrismaClient, Bucket } from '@rivocloud/db';
import type { Client as MinioClient } from 'minio';
import { NotificationConfig, QueueConfig, ObjectCreatedPut } from 'minio';
import { PRISMA } from '../prisma/prisma.module.js';
import { MINIO } from '../minio/minio.module.js';
import { physicalBucketName } from './bucket-name.util.js';
import type { CreateBucketDto } from './dto/create-bucket.dto.js';
import type { UpdateBucketDto } from './dto/update-bucket.dto.js';

const MINIO_WEBHOOK_ARN = 'arn:minio:sqs::STORAGE:webhook';

@Injectable()
export class BucketsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(MINIO) private readonly minio: MinioClient,
  ) {}

  async create(orgId: string, dto: CreateBucketDto) {
    let bucket;
    try {
      bucket = await this.db.bucket.create({
        data: { orgId, name: dto.name, region: dto.region ?? 'eu-central', public: dto.public ?? false },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`A bucket named "${dto.name}" already exists in this organization`);
      }
      throw error;
    }
    const physicalName = physicalBucketName(bucket.id);
    await this.minio.makeBucket(physicalName, bucket.region);
    const notification = new NotificationConfig();
    const queueConfig = new QueueConfig(MINIO_WEBHOOK_ARN);
    queueConfig.addEvent(ObjectCreatedPut);
    notification.add(queueConfig);
    await this.minio.setBucketNotification(physicalName, notification);
    return bucket;
  }

  async list(orgId: string, skip: number, take: number) {
    const [buckets, total] = await Promise.all([
      this.db.bucket.findMany({ where: { orgId }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.bucket.count({ where: { orgId } }),
    ]);
    return { buckets, total };
  }

  async getForOrg(orgId: string, bucketId: string) {
    return this.findOwned(orgId, bucketId);
  }

  async update(orgId: string, bucketId: string, dto: UpdateBucketDto) {
    await this.findOwned(orgId, bucketId);
    return this.db.bucket.update({
      where: { id: bucketId },
      data: {
        ...(dto.public !== undefined && { public: dto.public }),
        ...(dto.versioningEnabled !== undefined && { versioningEnabled: dto.versioningEnabled }),
        ...(dto.lifecycleRules !== undefined && { lifecycleRules: dto.lifecycleRules as Prisma.InputJsonValue }),
      },
    });
  }

  async remove(orgId: string, bucketId: string): Promise<void> {
    const bucket = await this.findOwned(orgId, bucketId);
    const remaining = await this.db.storageObject.count({ where: { bucketId, status: { not: 'deleted' } } });
    if (remaining > 0) {
      throw new ConflictException('Bucket is not empty — delete its objects first');
    }
    await this.minio.removeBucket(physicalBucketName(bucket.id));
    await this.db.bucket.delete({ where: { id: bucketId } });
  }

  private async findOwned(orgId: string, bucketId: string): Promise<Bucket> {
    const bucket = await this.db.bucket.findUnique({ where: { id: bucketId } });
    if (!bucket || bucket.orgId !== orgId) {
      throw new NotFoundException('Bucket not found');
    }
    return bucket;
  }
}
