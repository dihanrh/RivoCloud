import { describe, expect, it } from 'vitest';
import { decodeAccessToken, isExpired } from './jwt';

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

describe('decodeAccessToken', () => {
  it('reads sub/org/role/exp without verifying the signature', () => {
    const token = fakeJwt({ sub: 'user-1', org: 'org-1', role: 'owner', exp: 1234567890, jti: 'abc' });
    expect(decodeAccessToken(token)).toEqual({ sub: 'user-1', org: 'org-1', role: 'owner', exp: 1234567890 });
  });

  it('defaults org/role to null when absent', () => {
    const token = fakeJwt({ sub: 'user-1', exp: 1234567890 });
    expect(decodeAccessToken(token)).toEqual({ sub: 'user-1', org: null, role: null, exp: 1234567890 });
  });

  it('returns null for a malformed token', () => {
    expect(decodeAccessToken('not-a-jwt')).toBeNull();
  });
});

describe('isExpired', () => {
  it('is true once past exp minus the skew window', () => {
    const nowSeconds = Date.now() / 1000;
    expect(isExpired(nowSeconds + 5, 10)).toBe(true);
    expect(isExpired(nowSeconds + 1000, 10)).toBe(false);
  });
});
