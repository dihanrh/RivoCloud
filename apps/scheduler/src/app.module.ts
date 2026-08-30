import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { DomainVerificationService } from './domains/domain-verification.service.js';
import { DomainVerificationCron } from './domains/domain-verification.cron.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, ScheduleModule.forRoot()],
  controllers: [HealthController],
  providers: [DomainVerificationService, DomainVerificationCron],
})
export class AppModule {}
