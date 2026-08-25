import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { MinioModule } from './minio/minio.module.js';
import { HealthController } from './health/health.controller.js';
import { BucketsModule } from './buckets/buckets.module.js';
import { ObjectsModule } from './objects/objects.module.js';

@Module({
  imports: [EnvModule, PrismaModule, EventsModule, MinioModule, BucketsModule, ObjectsModule],
  controllers: [HealthController],
})
export class AppModule {}
