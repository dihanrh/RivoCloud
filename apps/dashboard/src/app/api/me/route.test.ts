import { afterEach, describe, expect, it, vi } from 'vitest';

const session = { accessToken: '', org: 'org-1', newTokens: null as null };
const backendFetch = vi.fn();

vi.mock('@/lib/env', () => ({ getEnv: () => ({ IDENTITY_SERVICE_URL: 'http://identity' }) }));
vi.mock('@/lib/auth-session', () => ({
  resolveSession: async () => session,
  applySessionCookies: vi.fn(),
}));
vi.mock('@/lib/forwarded-headers', () => ({ clientForwardHeaders: async () => ({}) }));
vi.mock('@/lib/backend-fetch', () => ({
  backendFetch: (...args: unknown[]) => backendFetch(...args),
  BackendError: class BackendError extends Error {},
}));

import { GET } from './route';

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('GET /api/me', () => {
  afterEach(() => backendFetch.mockReset());

  it("returns identity's live role, not the access token's (possibly stale) role claim", async () => {
    session.accessToken = fakeJwt({ sub: 'u1', org: 'org-1', role: 'developer', exp: Date.now() / 1000 + 900 });
    backendFetch.mockResolvedValue({ id: 'u1', email: 'a@example.com', name: 'A', role: 'admin' });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'u1',
      email: 'a@example.com',
      name: 'A',
      orgId: 'org-1',
      role: 'admin',
    });
  });

  it('returns a null role when identity reports none', async () => {
    session.accessToken = fakeJwt({ sub: 'u1', org: 'org-1', role: 'owner', exp: Date.now() / 1000 + 900 });
    backendFetch.mockResolvedValue({ id: 'u1', email: 'a@example.com', name: 'A', role: null });

    const body = await (await GET()).json();

    expect(body.role).toBeNull();
  });
});
