import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { AuditWriter, SECURITY_PRISMA } from './audit/audit-writer.js';
import { RateLimitInterceptor } from './rate-limit/rate-limit.interceptor.js';
import { SECURITY_OPTIONS, SECURITY_REDIS, type SecurityOptions } from './rate-limit/policies.js';
import { SlidingWindowLimiter } from './rate-limit/sliding-window.js';
import { ScopeGuard } from './rbac/scope.guard.js';

export interface SecurityModuleOptions {
  redisToken: string | symbol;
  prismaToken: string | symbol;
  envToken: string | symbol;
}

@Module({})
export class SecurityModule {
  static forRoot({ redisToken, prismaToken, envToken }: SecurityModuleOptions): DynamicModule {
    return {
      module: SecurityModule,
      global: true,
      providers: [
        { provide: SECURITY_REDIS, useExisting: redisToken },
        { provide: SECURITY_PRISMA, useExisting: prismaToken },
        {
          provide: SECURITY_OPTIONS,
          useFactory: (env: { RATE_LIMIT_ENABLED: boolean }): SecurityOptions => ({
            rateLimitEnabled: env.RATE_LIMIT_ENABLED,
          }),
          inject: [envToken],
        },
        SlidingWindowLimiter,
        AuditWriter,
        ScopeGuard,
        // Order matters: rate limiting runs before the audit interceptor.
        { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
      exports: [ScopeGuard, SECURITY_OPTIONS, SECURITY_REDIS, SECURITY_PRISMA, SlidingWindowLimiter, AuditWriter],
    };
  }
}
