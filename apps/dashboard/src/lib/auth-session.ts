import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { decodeAccessToken, isExpired } from './jwt';
import { backendFetch } from './backend-fetch';
import { clientForwardHeaders } from './forwarded-headers';
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

// Identity-service's refresh tokens are single-use/rotating. If we deleted the
// in-flight entry the instant a refresh settled, a caller that arrives a moment
// late (after the entry was cleared) would attempt its own refresh with the
// now-consumed token and fail, causing a spurious logout. Instead, keep the
// settled result (success or failure) cached for a short grace window so late
// arrivals reuse it instead of re-refreshing a dead token.
const inFlightRefreshes = new Map<string, Promise<AuthTokens | null>>();
const REFRESH_RESULT_GRACE_MS = 10_000;
const REFRESH_TIMEOUT_MS = 10_000;

export async function refreshTokens(refreshToken: string): Promise<AuthTokens | null> {
  const existing = inFlightRefreshes.get(refreshToken);
  if (existing) return existing;

  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    try {
      const forwarded = await clientForwardHeaders();
      return (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        headers: forwarded,
        signal: controller.signal,
      })) as AuthTokens;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  })();

  inFlightRefreshes.set(refreshToken, promise);
  promise.finally(() => {
    const clearGrace = setTimeout(() => {
      if (inFlightRefreshes.get(refreshToken) === promise) {
        inFlightRefreshes.delete(refreshToken);
      }
    }, REFRESH_RESULT_GRACE_MS);
    // Don't let this grace-window timer keep the Node process (or a test run) alive.
    clearGrace.unref?.();
  });

  return promise;
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

  const tokens = await refreshTokens(refresh);
  if (!tokens) return null;

  const newDecoded = decodeAccessToken(tokens.accessToken);
  return { accessToken: tokens.accessToken, org: newDecoded?.org ?? null, newTokens: tokens };
}

export function applySessionCookies(response: NextResponse, tokens: AuthTokens): void {
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS));
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_TOKEN_MAX_AGE_SECONDS));
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
}
