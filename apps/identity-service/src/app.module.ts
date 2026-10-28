import { Module } from '@nestjs/common';
import { SecurityModule } from '@rivocloud/security';
import { APP_ENV } from './app-env.token.js';
import { EnvModule } from './env.module.js';
import { PRISMA, PrismaModule } from './prisma/prisma.module.js';
import { REDIS, RedisModule } from './redis/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { InternalModule } from './internal/internal.module.js';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    SecurityModule.forRoot({ redisToken: REDIS, prismaToken: PRISMA, envToken: APP_ENV }),
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ApiKeysModule,
    InternalModule,
    AuditLogsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
