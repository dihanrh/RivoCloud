import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { decodeAccessToken, isExpired } from './jwt';
import { backendFetch } from './backend-fetch';
import { getEnv } from './env';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  cookieOptions,
  REFRESH_COOKIE,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
} from './cookies';
import type { AuthTokens } from './types';

export interface SessionResult {
  accessToken: string;
  org: string | null;
  newTokens: AuthTokens | null;
}

export async function resolveSession(): Promise<SessionResult | null> {
  const store = await cookies();
  const access = store.get(ACCESS_COOKIE)?.value;
  const refresh = store.get(REFRESH_COOKIE)?.value;
  const decoded = access ? decodeAccessToken(access) : null;

  if (access && decoded && !isExpired(decoded.exp)) {
    return { accessToken: access, org: decoded.org, newTokens: null };
  }

  if (!refresh) return null;

  try {
    const tokens = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: refresh }),
    })) as AuthTokens;
    const newDecoded = decodeAccessToken(tokens.accessToken);
    return { accessToken: tokens.accessToken, org: newDecoded?.org ?? null, newTokens: tokens };
  } catch {
    return null;
  }
}

export function applySessionCookies(response: NextResponse, tokens: AuthTokens): void {
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS));
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
}
