import { Module } from '@nestjs/common';
import { SecurityModule } from '@rivocloud/security';
import { APP_ENV } from './app-env.token.js';
import { EnvModule } from './env.module.js';
import { PRISMA, PrismaModule } from './prisma/prisma.module.js';
import { REDIS, RedisModule } from './redis/redis.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { ZonesModule } from './zones/zones.module.js';
import { RulesModule } from './rules/rules.module.js';
import { InvalidationsModule } from './invalidations/invalidations.module.js';
import { DomainsModule } from './domains/domains.module.js';
import { SignedUrlsModule } from './signed-urls/signed-urls.module.js';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    SecurityModule.forRoot({ redisToken: REDIS, prismaToken: PRISMA, envToken: APP_ENV }),
    EventsModule,
    ZonesModule,
    RulesModule,
    InvalidationsModule,
    DomainsModule,
    SignedUrlsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
