import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { configureTrustProxy, SECURITY_OPTIONS } from '@rivocloud/security';
import { AppModule } from '../app.module.js';
import { REDIS } from '../redis/redis.module.js';
import { registerAndLogin } from '../test-support/org-fixtures.js';

/** Deletes only rate-limit keys (never FLUSHALL: Redis also holds the token blacklist). */
async function clearRateLimitKeys(redis: Redis): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'ratelimit:*', 'COUNT', 500);
    if (keys.length > 0) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

describe('Rate limiting', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SECURITY_OPTIONS)
      .useValue({ rateLimitEnabled: true })
      .compile();
    app = moduleRef.createNestApplication();
    configureTrustProxy(app, 'loopback');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    redis = moduleRef.get<Redis>(REDIS);
  });

  beforeEach(async () => {
    await clearRateLimitKeys(redis);
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await clearRateLimitKeys(redis);
    await app.close();
  });

  const login = (ip: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

  it('the 11th login in a minute from one IP gets 429 with Retry-After', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await login('203.0.113.10');
      expect(res.status).toBe(401);
    }
    const limited = await login('203.0.113.10');
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('separate X-Forwarded-For clients get separate buckets', async () => {
    for (let i = 0; i < 10; i++) {
      await login('198.51.100.1');
    }
    expect((await login('198.51.100.1')).status).toBe(429);
    const other = await login('198.51.100.2');
    expect(other.status).not.toBe(429);
  });

  it('the 6th forgot-password in an hour gets 429', async () => {
    const forgot = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .set('X-Forwarded-For', '203.0.113.20')
        .send({ email: 'nobody@example.com' });
    for (let i = 0; i < 5; i++) {
      expect((await forgot()).status).toBe(201);
    }
    const limited = await forgot();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('authenticated requests count against the general bucket', async () => {
    const token = await registerAndLogin(app, 'ratelimited@example.com', 'Rate Limited');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ratelimited@example.com' } });

    const me = () => request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
    expect((await me()).status).toBe(200);

    const key = `ratelimit:general:user:${user.id}`;
    const now = Date.now();
    const members: (string | number)[] = [];
    for (let i = 0; i < 1000; i++) members.push(now, `seed-${i}`);
    await redis.zadd(key, ...members);

    const limited = await me();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
