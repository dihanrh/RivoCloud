import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { lastValueFrom, of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITER_TIMEOUT_MS } from './policies.js';
import { RateLimitInterceptor } from './rate-limit.interceptor.js';
import { SlidingWindowLimiter } from './sliding-window.js';

// Real ioredis defaults (offline queue on, maxRetriesPerRequest 20) against a port nothing listens on:
// without a bound, MULTI only rejects after ~20 reconnect backoffs.
describe('RateLimitInterceptor with Redis unreachable', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis('redis://127.0.0.1:1', { lazyConnect: true });
    redis.on('error', () => undefined);
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('fails open in well under 2s', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const interceptor = new RateLimitInterceptor(new Reflector(), new SlidingWindowLimiter(redis), {
      rateLimitEnabled: true,
      limiterTimeoutMs: DEFAULT_LIMITER_TIMEOUT_MS,
    });
    class Ctl {
      plain() {}
    }
    const context = {
      getHandler: () => Ctl.prototype.plain,
      getClass: () => Ctl,
      switchToHttp: () => ({
        getRequest: () => ({ auth: { type: 'api_key', userId: 'u1', orgId: 'o1', role: 'admin', apiKeyId: 'k1' } }),
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
    } as unknown as ExecutionContext;
    const handle = vi.fn(() => of('ok'));

    const started = Date.now();
    const result = await lastValueFrom(await interceptor.intercept(context, { handle } as CallHandler));
    const elapsed = Date.now() - started;

    expect(result).toBe('ok');
    expect(handle).toHaveBeenCalled();
    expect(elapsed).toBeLessThan(2000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    warn.mockRestore();
  });
});
