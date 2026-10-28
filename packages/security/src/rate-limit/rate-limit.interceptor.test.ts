import { CallHandler, ExecutionContext, HttpException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimit } from './rate-limit.decorator.js';
import { RateLimitInterceptor } from './rate-limit.interceptor.js';
import { RATE_LIMITS } from './policies.js';

class Ctl {
  @RateLimit(RATE_LIMITS.auth)
  login() {}
  @RateLimit(RATE_LIMITS.cacheInvalidation)
  purge() {}
  plain() {}
}

function setup(opts: {
  handler?: keyof Ctl;
  request?: Record<string, unknown>;
  enabled?: boolean;
  hit?: ReturnType<typeof vi.fn>;
  limiterTimeoutMs?: number;
}) {
  const hit = opts.hit ?? vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  const setHeader = vi.fn();
  const request = opts.request ?? {};
  const context = {
    getHandler: () => Ctl.prototype[opts.handler ?? 'plain'],
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  const handle = vi.fn(() => of('ok'));
  const next = { handle } as CallHandler;
  const interceptor = new RateLimitInterceptor(new Reflector(), { hit } as never, {
    rateLimitEnabled: opts.enabled ?? true,
    ...(opts.limiterTimeoutMs === undefined ? {} : { limiterTimeoutMs: opts.limiterTimeoutMs }),
  });
  return { interceptor, context, next, hit, setHeader, handle };
}

describe('RateLimitInterceptor', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const keysOf = (hit: ReturnType<typeof vi.fn>) => hit.mock.calls.map((c) => c[0]);

  it('applies general to authenticated requests keyed by user', async () => {
    const t = setup({ request: { auth: { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'admin' } } });
    await lastValueFrom(await t.interceptor.intercept(t.context, t.next));
    expect(keysOf(t.hit)).toEqual(['ratelimit:general:user:u1']);
    expect(t.hit).toHaveBeenCalledWith('ratelimit:general:user:u1', 1000, 60);
  });

  it('keys API-key callers by apiKeyId', async () => {
    const t = setup({ request: { auth: { type: 'api_key', userId: 'u1', orgId: 'o1', role: 'admin', apiKeyId: 'k1' } } });
    await lastValueFrom(await t.interceptor.intercept(t.context, t.next));
    expect(keysOf(t.hit)).toEqual(['ratelimit:general:apikey:k1']);
  });

  it('applies ip policies to anonymous requests', async () => {
    const t = setup({ handler: 'login', request: { ip: '203.0.113.9' } });
    await lastValueFrom(await t.interceptor.intercept(t.context, t.next));
    expect(keysOf(t.hit)).toEqual(['ratelimit:auth:ip:203.0.113.9']);
  });

  it('param policies key by the route param', async () => {
    const t = setup({
      handler: 'purge',
      request: { auth: { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'admin' }, params: { zoneId: 'z1' } },
    });
    await lastValueFrom(await t.interceptor.intercept(t.context, t.next));
    expect(keysOf(t.hit)).toEqual(['ratelimit:general:user:u1', 'ratelimit:cache-invalidation:zone:z1']);
  });

  it('skips principal policies when request.auth is absent', async () => {
    const t = setup({ request: { ip: '1.1.1.1' } });
    await lastValueFrom(await t.interceptor.intercept(t.context, t.next));
    expect(t.hit).not.toHaveBeenCalled();
    expect(t.handle).toHaveBeenCalled();
  });

  it('rejects with 429 and Retry-After', async () => {
    const hit = vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 8 });
    const t = setup({ hit, request: { auth: { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'admin' } } });
    const err = await t.interceptor.intercept(t.context, t.next).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toEqual({ statusCode: 429, message: 'Too many requests' });
    expect(t.setHeader).toHaveBeenCalledWith('Retry-After', '8');
    expect(t.handle).not.toHaveBeenCalled();
  });

  it('fails open when the limiter throws', async () => {
    const hit = vi.fn().mockRejectedValue(new Error('redis down'));
    const t = setup({ hit, request: { auth: { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'admin' } } });
    await lastValueFrom(await t.interceptor.intercept(t.context, t.next));
    expect(t.handle).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('fails open quickly when the limiter never settles', async () => {
    vi.useFakeTimers();
    try {
      const hit = vi.fn(() => new Promise(() => undefined));
      const t = setup({ hit, request: { auth: { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'admin' } } });
      const pending = t.interceptor.intercept(t.context, t.next);
      await vi.advanceTimersByTimeAsync(250);
      await lastValueFrom(await pending);
      expect(t.handle).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out after 250ms'));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours a configured limiterTimeoutMs and clears its timer on success', async () => {
    vi.useFakeTimers();
    try {
      const never = setup({
        hit: vi.fn(() => new Promise(() => undefined)),
        limiterTimeoutMs: 50,
        request: { auth: { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'admin' } },
      });
      const pending = never.interceptor.intercept(never.context, never.next);
      await vi.advanceTimersByTimeAsync(50);
      await lastValueFrom(await pending);
      expect(never.handle).toHaveBeenCalled();

      const fast = setup({ request: { auth: { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'admin' } } });
      await lastValueFrom(await fast.interceptor.intercept(fast.context, fast.next));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when rateLimitEnabled is false', async () => {
    const t = setup({ enabled: false, request: { auth: { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'admin' } } });
    await lastValueFrom(await t.interceptor.intercept(t.context, t.next));
    expect(t.hit).not.toHaveBeenCalled();
    expect(t.handle).toHaveBeenCalled();
  });
});
