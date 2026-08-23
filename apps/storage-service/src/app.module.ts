import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { MinioModule } from './minio/minio.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [EnvModule, PrismaModule, EventsModule, MinioModule],
  controllers: [HealthController],
})
export class AppModule {}
