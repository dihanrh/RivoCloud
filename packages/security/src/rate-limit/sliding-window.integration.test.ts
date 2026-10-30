import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './sliding-window.js';

describe('SlidingWindowLimiter (Redis)', () => {
  let redis: Redis;
  let limiter: SlidingWindowLimiter;
  const keys: string[] = [];
  const newKey = () => {
    const key = `test:sw:${randomUUID()}`;
    keys.push(key);
    return key;
  };

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    limiter = new SlidingWindowLimiter(redis);
  });

  afterEach(async () => {
    if (keys.length) await redis.del(...keys.splice(0));
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('allows exactly limit hits then rejects', async () => {
    const key = newKey();
    for (let i = 0; i < 3; i++) {
      expect((await limiter.hit(key, 3, 60)).allowed).toBe(true);
    }
    expect((await limiter.hit(key, 3, 60)).allowed).toBe(false);
  });

  it('retryAfterSeconds counts down to the oldest hit leaving the window', async () => {
    const key = newKey();
    const now = Date.now();
    await limiter.hit(key, 3, 10, now);
    await limiter.hit(key, 3, 10, now + 1000);
    await limiter.hit(key, 3, 10, now + 2000);
    expect(await limiter.hit(key, 3, 10, now + 2500)).toEqual({ allowed: false, retryAfterSeconds: 8 });
  });

  it('hits older than the window stop counting', async () => {
    const key = newKey();
    const now = Date.now();
    expect((await limiter.hit(key, 1, 1, now)).allowed).toBe(true);
    expect((await limiter.hit(key, 1, 1, now + 1001)).allowed).toBe(true);
  });

  it('sets a TTL on the key', async () => {
    const key = newKey();
    await limiter.hit(key, 3, 60);
    const ttl = await redis.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});
