import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { InternalModule } from './internal/internal.module.js';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ApiKeysModule,
    InternalModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
