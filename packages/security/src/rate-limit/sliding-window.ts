import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { SECURITY_REDIS } from './policies.js';

export interface HitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class SlidingWindowLimiter {
  constructor(@Inject(SECURITY_REDIS) private readonly redis: Redis) {}

  /** Records a hit (rejected hits still count) and reports whether it is within the limit. */
  async hit(key: string, limit: number, windowSeconds: number, nowMs: number = Date.now()): Promise<HitResult> {
    const windowMs = windowSeconds * 1000;
    const results = await this.redis
      .multi()
      .zremrangebyscore(key, '-inf', nowMs - windowMs)
      .zadd(key, nowMs, `${nowMs}-${randomUUID()}`)
      .zcard(key)
      .zrange(key, 0, 0, 'WITHSCORES')
      .pexpire(key, windowMs)
      .exec();
    if (!results) throw new Error('Redis MULTI returned no result');
    for (const [err] of results) {
      if (err) throw err;
    }
    const count = results[2]![1] as number;
    if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
    const oldest = Number((results[3]![1] as string[])[1]);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)) };
  }
}
