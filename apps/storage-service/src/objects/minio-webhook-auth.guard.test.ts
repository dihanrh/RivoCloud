import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { MinioWebhookAuthGuard } from './minio-webhook-auth.guard.js';
import type { AppEnv } from '../env.js';

function contextWith(headers: Record<string, string>) {
  const request = { headers };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const fakeEnv = { MINIO_WEBHOOK_AUTH_TOKEN: 'expected-token' } as AppEnv;

describe('MinioWebhookAuthGuard', () => {
  it('rejects a request with no Authorization header', () => {
    const guard = new MinioWebhookAuthGuard(fakeEnv);
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });

  it('rejects a request with the wrong token', () => {
    const guard = new MinioWebhookAuthGuard(fakeEnv);
    expect(() => guard.canActivate(contextWith({ authorization: 'Bearer wrong-token' }))).toThrow(UnauthorizedException);
  });

  it('accepts a request with the correct bearer token', () => {
    const guard = new MinioWebhookAuthGuard(fakeEnv);
    expect(guard.canActivate(contextWith({ authorization: 'Bearer expected-token' }))).toBe(true);
  });
});
