/**
 * In-memory stand-in for the identity, cdn, storage and analytics services,
 * used when RIVO_DEMO_BACKEND=mock (e.g. a Vercel demo with no backend).
 * src/lib/backend-fetch.ts routes every backend call here, so the Next route
 * handlers run unchanged. See docs/deploy-vercel.md.
 *
 * Each browser gets its own copy of the demo dataset, keyed by the
 * `rivo_demo_sid` cookie, so concurrent visitors don't see each other's edits.
 * State lives in module memory: it survives while a serverless instance is
 * warm and resets on a cold start (or after two idle hours).
 */
import { randomToken } from './ids';
import { dispatch, serviceFor } from './router';
import { getWorld, type World } from './world';
import type { DemoResponse } from './http';
import { DEMO_SERVICE_URLS, getEnv } from '../env';

export const DEMO_SESSION_COOKIE = 'rivo_demo_sid';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600;
const SID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** Used when no per-browser cookie can be read or set (e.g. outside a request). */
const SHARED_SESSION = 'shared';

/** The calling browser's demo session id, minting the cookie on first use. */
export async function demoSessionId(): Promise<string> {
  try {
    const { cookies } = await import('next/headers');
    const store = await cookies();
    const existing = store.get(DEMO_SESSION_COOKIE)?.value;
    if (existing && SID_PATTERN.test(existing)) return existing;
    const sid = randomToken(18);
    try {
      store.set(DEMO_SESSION_COOKIE, sid, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
      return sid;
    } catch {
      // Read-only cookie store: fall back to the shared world rather than a throwaway one.
      return SHARED_SESSION;
    }
  } catch {
    return SHARED_SESSION;
  }
}

export async function demoWorld(): Promise<World> {
  return getWorld(await demoSessionId());
}

/** The dashboard's public origin, for absolute links (signed URLs). */
async function requestOrigin(): Promise<string> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (host) {
      const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? (host.startsWith('localhost') ? 'http' : 'https');
      return `${proto}://${host}`;
    }
  } catch {
    // Not inside a request.
  }
  return 'http://localhost:3000';
}

function header(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : null;
}

export async function handleDemoRequest(
  baseUrl: string,
  path: string,
  init: { method?: string; body?: string; accessToken?: string; headers?: Record<string, string> },
): Promise<DemoResponse> {
  const env = getEnv();
  const service = serviceFor(baseUrl, path, {
    identity: env.IDENTITY_SERVICE_URL ?? DEMO_SERVICE_URLS.IDENTITY_SERVICE_URL,
    cdn: env.CDN_SERVICE_URL ?? DEMO_SERVICE_URLS.CDN_SERVICE_URL,
    storage: env.STORAGE_SERVICE_URL ?? DEMO_SERVICE_URLS.STORAGE_SERVICE_URL,
    analytics: env.ANALYTICS_SERVICE_URL ?? DEMO_SERVICE_URLS.ANALYTICS_SERVICE_URL,
  });
  const world = await demoWorld();
  const result = dispatch(world, {
    service,
    method: init.method ?? 'GET',
    path,
    body: init.body,
    accessToken: init.accessToken,
    ip: header(init.headers, 'x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: header(init.headers, 'user-agent'),
    origin: await requestOrigin(),
  });
  // Hand back a copy so callers can never mutate the store through a response.
  return { status: result.status, body: result.body === undefined ? null : JSON.parse(JSON.stringify(result.body)) };
}
