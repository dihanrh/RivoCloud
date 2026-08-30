import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule],
  controllers: [HealthController],
})
export class AppModule {}
