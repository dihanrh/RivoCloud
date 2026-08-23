import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { ZonesModule } from './zones/zones.module.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, EventsModule, ZonesModule],
  controllers: [HealthController],
})
export class AppModule {}
