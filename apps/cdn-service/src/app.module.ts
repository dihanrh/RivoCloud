import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { ZonesModule } from './zones/zones.module.js';
import { RulesModule } from './rules/rules.module.js';
import { InvalidationsModule } from './invalidations/invalidations.module.js';
import { DomainsModule } from './domains/domains.module.js';
import { SignedUrlsModule } from './signed-urls/signed-urls.module.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, EventsModule, ZonesModule, RulesModule, InvalidationsModule, DomainsModule, SignedUrlsModule],
  controllers: [HealthController],
})
export class AppModule {}
