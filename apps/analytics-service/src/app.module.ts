import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { SecurityModule } from '@rivocloud/security';
import { APP_ENV } from './app-env.token.js';
import { PRISMA, PrismaModule } from './prisma/prisma.module.js';
import { REDIS, RedisModule } from './redis/redis.module.js';
import { ClickhouseModule } from './clickhouse/clickhouse.module.js';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { IngestionInternalModule } from './ingestion/ingestion-internal.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    SecurityModule.forRoot({ redisToken: REDIS, prismaToken: PRISMA, envToken: APP_ENV }),
    ClickhouseModule,
    AuthModule,
    IngestionModule,
    IngestionInternalModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
