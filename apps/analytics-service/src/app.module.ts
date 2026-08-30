import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ClickhouseModule } from './clickhouse/clickhouse.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [EnvModule, PrismaModule, ClickhouseModule],
  controllers: [HealthController],
})
export class AppModule {}
