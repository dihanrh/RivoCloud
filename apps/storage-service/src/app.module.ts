import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { SecurityModule } from '@rivocloud/security';
import { APP_ENV } from './app-env.token.js';
import { PRISMA, PrismaModule } from './prisma/prisma.module.js';
import { REDIS, RedisModule } from './redis/redis.module.js';
import { EventsModule } from './events/events.module.js';
import { MinioModule } from './minio/minio.module.js';
import { HealthController } from './health/health.controller.js';
import { BucketsModule } from './buckets/buckets.module.js';
import { ObjectsModule } from './objects/objects.module.js';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    SecurityModule.forRoot({ redisToken: REDIS, prismaToken: PRISMA, envToken: APP_ENV }),
    EventsModule,
    MinioModule,
    BucketsModule,
    ObjectsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
