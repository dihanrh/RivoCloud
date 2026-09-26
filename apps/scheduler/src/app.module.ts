import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { DomainsModule } from './domains/domains.module.js';
import { ClickhouseModule } from './clickhouse/clickhouse.module.js';
import { AnalyticsRollupModule } from './analytics/analytics-rollup.module.js';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    ScheduleModule.forRoot(),
    DomainsModule,
    ClickhouseModule,
    AnalyticsRollupModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
