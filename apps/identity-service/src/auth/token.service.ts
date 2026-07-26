import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Redis } from 'ioredis';
import bcrypt from 'bcryptjs';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export interface AccessTokenClaims {
  sub: string;
  org: string | null;
  role: string | null;
  jti: string;
  iat: number;
  exp: number;
}

const REFRESH_HASH_ROUNDS = 10;

@Injectable()
export class TokenService {
  private readonly jwt: JwtService;
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) env: AppEnv,
    privateKeyOverride?: string,
    publicKeyOverride?: string,
  ) {
    const privateKey = privateKeyOverride ?? readFileSync(resolve(env.JWT_PRIVATE_KEY_PATH), 'utf-8');
    const publicKey = publicKeyOverride ?? readFileSync(resolve(env.JWT_PUBLIC_KEY_PATH), 'utf-8');
    this.jwt = new JwtService({ privateKey, publicKey, signOptions: { algorithm: 'RS256' } });
    this.accessTtl = env.JWT_ACCESS_TTL_SECONDS;
    this.refreshTtl = env.JWT_REFRESH_TTL_SECONDS;
  }

  async mintAccessToken(payload: { sub: string; org: string | null; role: string | null }): Promise<string> {
    return this.jwt.signAsync(
      { sub: payload.sub, org: payload.org, role: payload.role },
      { expiresIn: this.accessTtl, jwtid: randomUUID() },
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token, { algorithms: ['RS256'] });
  }

  async mintRefreshToken(userId: string): Promise<string> {
    const id = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const secretHash = await bcrypt.hash(secret, REFRESH_HASH_ROUNDS);
    await this.redis.set(`refresh:${id}`, JSON.stringify({ userId, secretHash }), 'EX', this.refreshTtl);
    return `${id}.${secret}`;
  }

  async verifyAndRotateRefreshToken(token: string): Promise<{ userId: string; newRefreshToken: string }> {
    const [id, secret] = token.split('.');
    if (!id || !secret) {
      throw new Error('Malformed refresh token');
    }
    const raw = await this.redis.get(`refresh:${id}`);
    if (!raw) {
      throw new Error('Refresh token not found or already used');
    }
    const { userId, secretHash } = JSON.parse(raw) as { userId: string; secretHash: string };
    const valid = await bcrypt.compare(secret, secretHash);
    if (!valid) {
      throw new Error('Refresh token signature mismatch');
    }
    await this.redis.del(`refresh:${id}`);
    const newRefreshToken = await this.mintRefreshToken(userId);
    return { userId, newRefreshToken };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const [id] = token.split('.');
    if (id) {
      await this.redis.del(`refresh:${id}`);
    }
  }

  async blacklistAccessToken(jti: string, expiresInSeconds: number): Promise<void> {
    if (expiresInSeconds <= 0) {
      return;
    }
    await this.redis.set(`jwt:blacklist:${jti}`, '1', 'EX', expiresInSeconds);
  }

  async isAccessTokenBlacklisted(jti: string): Promise<boolean> {
    const value = await this.redis.get(`jwt:blacklist:${jti}`);
    return value !== null;
  }
}
