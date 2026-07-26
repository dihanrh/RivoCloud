import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Redis } from 'ioredis';
import { TokenService } from './token.service.js';
import type { AppEnv } from '../env.js';

const privateKey = readFileSync(join(__dirname, '../../keys/private.pem'), 'utf-8');
const publicKey = readFileSync(join(__dirname, '../../keys/public.pem'), 'utf-8');

const env = {
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 2592000,
} as AppEnv;

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
  } as unknown as Redis;
}

describe('TokenService', () => {
  let redis: Redis;
  let service: TokenService;

  beforeEach(() => {
    redis = fakeRedis();
    service = new TokenService(redis, env, privateKey, publicKey);
  });

  it('mints an access token whose claims round-trip through verifyAccessToken', async () => {
    const token = await service.mintAccessToken({ sub: 'user-1', org: 'org-1', role: 'owner' });
    const claims = await service.verifyAccessToken(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.org).toBe('org-1');
    expect(claims.role).toBe('owner');
    expect(typeof claims.jti).toBe('string');
  });

  it('mints a refresh token, verifies it, and rotates it to a new single-use token', async () => {
    const refreshToken = await service.mintRefreshToken('user-1');
    const { userId, newRefreshToken } = await service.verifyAndRotateRefreshToken(refreshToken);
    expect(userId).toBe('user-1');
    expect(newRefreshToken).not.toBe(refreshToken);

    await expect(service.verifyAndRotateRefreshToken(refreshToken)).rejects.toThrow();
  });

  it('blacklists an access token jti and reports it as blacklisted', async () => {
    const token = await service.mintAccessToken({ sub: 'user-1', org: null, role: null });
    const claims = await service.verifyAccessToken(token);
    await service.blacklistAccessToken(claims.jti, 900);
    await expect(service.isAccessTokenBlacklisted(claims.jti)).resolves.toBe(true);
  });

  it('reports an unknown jti as not blacklisted', async () => {
    await expect(service.isAccessTokenBlacklisted('never-issued')).resolves.toBe(false);
  });
});
