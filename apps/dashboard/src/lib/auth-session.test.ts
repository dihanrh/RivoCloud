import { afterEach, describe, expect, it, vi } from 'vitest';

const cookieStore = new Map<string, { value: string }>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
  }),
}));

vi.mock('./env', () => ({
  getEnv: () => ({ IDENTITY_SERVICE_URL: 'http://identity', CDN_SERVICE_URL: 'http://cdn', STORAGE_SERVICE_URL: 'http://storage' }),
}));

import { resolveSession } from './auth-session';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('resolveSession', () => {
  afterEach(() => {
    cookieStore.clear();
    vi.unstubAllGlobals();
  });

  it('returns the session unchanged when the access token is still valid', async () => {
    const token = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 + 900 });
    cookieStore.set(ACCESS_COOKIE, { value: token });

    const session = await resolveSession();

    expect(session).toEqual({ accessToken: token, org: 'org-1', newTokens: null });
  });

  it('returns null when there is no access token and no refresh token', async () => {
    expect(await resolveSession()).toBeNull();
  });

  it('refreshes when the access token is expired and a refresh token exists', async () => {
    const expired = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 - 100 });
    const freshAccess = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 + 900 });
    cookieStore.set(ACCESS_COOKIE, { value: expired });
    cookieStore.set(REFRESH_COOKIE, { value: 'refresh-abc' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessToken: freshAccess, refreshToken: 'refresh-xyz' }), { status: 200 }),
      ),
    );

    const session = await resolveSession();

    expect(session).toEqual({
      accessToken: freshAccess,
      org: 'org-1',
      newTokens: { accessToken: freshAccess, refreshToken: 'refresh-xyz' },
    });
  });

  it('returns null when the refresh call fails', async () => {
    const expired = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 - 100 });
    cookieStore.set(ACCESS_COOKIE, { value: expired });
    cookieStore.set(REFRESH_COOKIE, { value: 'refresh-abc' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    expect(await resolveSession()).toBeNull();
  });

  it('de-dups concurrent refresh calls for the same refresh token into a single network call', async () => {
    const expired = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 - 100 });
    const freshAccess = fakeJwt({ sub: 'u1', org: 'org-1', exp: Date.now() / 1000 + 900 });
    cookieStore.set(ACCESS_COOKIE, { value: expired });
    cookieStore.set(REFRESH_COOKIE, { value: 'refresh-abc' });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: freshAccess, refreshToken: 'refresh-xyz' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const [session1, session2] = await Promise.all([resolveSession(), resolveSession()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const expected = {
      accessToken: freshAccess,
      org: 'org-1',
      newTokens: { accessToken: freshAccess, refreshToken: 'refresh-xyz' },
    };
    expect(session1).toEqual(expected);
    expect(session2).toEqual(expected);
  });
});
