export interface DecodedAccessToken {
  sub: string;
  org: string | null;
  role: string | null;
  exp: number;
}

export function decodeAccessToken(token: string): DecodedAccessToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    return {
      sub: payload.sub,
      org: typeof payload.org === 'string' ? payload.org : null,
      role: typeof payload.role === 'string' ? payload.role : null,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function isExpired(exp: number, skewSeconds = 10): boolean {
  return Date.now() / 1000 >= exp - skewSeconds;
}
