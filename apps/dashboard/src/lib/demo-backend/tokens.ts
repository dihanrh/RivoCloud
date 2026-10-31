import { createHmac } from 'node:crypto';
import { newId, randomToken } from './ids';
import type { OrgRole } from '../types';

// The dashboard only decodes access tokens (src/lib/jwt.ts); it never verifies
// them. The signature is still a real HMAC so the token is a well-formed JWT.
const DEMO_SIGNING_KEY = 'rivocloud-demo-backend-not-a-secret';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessClaims {
  sub: string;
  org: string | null;
  role: OrgRole | null;
  exp: number;
  iat: number;
  jti: string;
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function mintAccessToken(claims: { sub: string; org: string | null; role: OrgRole | null }, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ ...claims, iat, exp: iat + ACCESS_TOKEN_TTL_SECONDS, jti: newId() });
  const signature = createHmac('sha256', DEMO_SIGNING_KEY).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function decodeAccessClaims(token: string): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    return {
      sub: payload.sub,
      org: typeof payload.org === 'string' ? payload.org : null,
      role: typeof payload.role === 'string' ? (payload.role as OrgRole) : null,
      exp: payload.exp,
      iat: typeof payload.iat === 'number' ? payload.iat : 0,
      jti: typeof payload.jti === 'string' ? payload.jti : '',
    };
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are opaque to the dashboard. They carry the user id so a
 * refresh still works on a fresh serverless instance (no shared token store).
 */
export function mintRefreshToken(userId: string): string {
  return `rdt_${Buffer.from(userId).toString('base64url')}.${randomToken(24)}`;
}

export function refreshTokenUser(token: string): string | null {
  const match = /^rdt_([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/.exec(token);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
}
