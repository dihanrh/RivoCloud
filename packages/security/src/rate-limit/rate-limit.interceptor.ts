import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import type { SecurityAuthContext } from '../rbac/auth-context.js';
import { RATE_LIMIT_KEY } from './rate-limit.decorator.js';
import {
  DEFAULT_LIMITER_TIMEOUT_MS,
  RATE_LIMITS,
  SECURITY_OPTIONS,
  type RateLimitPolicy,
  type SecurityOptions,
} from './policies.js';
import { SlidingWindowLimiter, type HitResult } from './sliding-window.js';

interface RateLimitedRequest {
  ip?: string;
  auth?: SecurityAuthContext;
  params?: Record<string, string>;
}

// A global interceptor (not a guard) so it runs after every guard and sees request.auth.
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: SlidingWindowLimiter,
    @Inject(SECURITY_OPTIONS) private readonly options: SecurityOptions,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (!this.options.rateLimitEnabled) return next.handle();

    const http = context.switchToHttp();
    const request: RateLimitedRequest = http.getRequest();
    const policies = this.policiesFor(context, request);

    try {
      for (const policy of policies) {
        const keyValue = this.keyValue(policy, request);
        if (keyValue === null) continue;
        const result = await this.boundedHit(`ratelimit:${policy.name}:${keyValue}`, policy);
        if (!result.allowed) {
          http.getResponse().setHeader('Retry-After', String(result.retryAfterSeconds));
          throw new HttpException({ statusCode: 429, message: 'Too many requests' }, HttpStatus.TOO_MANY_REQUESTS);
        }
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Fail open: a Redis outage (error or timeout) must not take the API down or stall it.
      this.logger.warn(`Rate limiter unavailable, allowing request: ${(err as Error).message}`);
    }
    return next.handle();
  }

  /**
   * Races the limiter against a timer. ioredis queues commands while disconnected and only
   * rejects after its retries are exhausted (seconds), so without a bound an outage would
   * stall every request instead of failing open.
   */
  private async boundedHit(key: string, policy: RateLimitPolicy): Promise<HitResult> {
    const timeoutMs = this.options.limiterTimeoutMs ?? DEFAULT_LIMITER_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`rate limiter timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      // Promise.race subscribes to both, so a late rejection of the losing hit is handled.
      return await Promise.race([this.limiter.hit(key, policy.limit, policy.windowSeconds), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private policiesFor(context: ExecutionContext, request: RateLimitedRequest): RateLimitPolicy[] {
    const declared = [context.getClass(), context.getHandler()].flatMap(
      (target) => this.reflector.get<RateLimitPolicy[] | undefined>(RATE_LIMIT_KEY, target) ?? [],
    );
    return request.auth ? [RATE_LIMITS.general, ...declared] : declared;
  }

  /** Returns null when the policy cannot apply (principal policy without request.auth). */
  private keyValue(policy: RateLimitPolicy, request: RateLimitedRequest): string | null {
    const { key } = policy;
    if (key === 'ip') return `ip:${request.ip ?? 'unknown'}`;
    if (key === 'principal') {
      const auth = request.auth;
      if (!auth) return null;
      return auth.apiKeyId ? `apikey:${auth.apiKeyId}` : `user:${auth.userId}`;
    }
    return `${key.param.replace(/Id$/, '')}:${request.params?.[key.param]}`;
  }
}
