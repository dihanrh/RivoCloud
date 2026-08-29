import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveSessionMock = vi.fn();
vi.mock('./auth-session', () => ({
  resolveSession: () => resolveSessionMock(),
  applySessionCookies: vi.fn(),
}));

import { proxyToBackend } from './proxy';
import { BackendError, backendFetch } from './backend-fetch';

vi.mock('./backend-fetch', async () => {
  const actual = await vi.importActual<typeof import('./backend-fetch')>('./backend-fetch');
  return { ...actual, backendFetch: vi.fn() };
});

describe('proxyToBackend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when there is no session', async () => {
    resolveSessionMock.mockResolvedValue(null);
    const response = await proxyToBackend('http://svc', '/api/v1/zones');
    expect(response.status).toBe(401);
  });

  it('returns 409 when the session has no org and requireOrg is not disabled', async () => {
    resolveSessionMock.mockResolvedValue({ accessToken: 'jwt', org: null, newTokens: null });
    const response = await proxyToBackend('http://svc', '/api/v1/zones');
    expect(response.status).toBe(409);
  });

  it('skips the org check when requireOrg is false', async () => {
    resolveSessionMock.mockResolvedValue({ accessToken: 'jwt', org: null, newTokens: null });
    vi.mocked(backendFetch).mockResolvedValue({ orgs: [] });

    const response = await proxyToBackend('http://svc', '/api/v1/orgs', {}, { requireOrg: false });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orgs: [] });
  });

  it('forwards a successful backend response as JSON', async () => {
    resolveSessionMock.mockResolvedValue({ accessToken: 'jwt', org: 'org-1', newTokens: null });
    vi.mocked(backendFetch).mockResolvedValue({ zones: [], total: 0 });

    const response = await proxyToBackend('http://svc', '/api/v1/zones');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ zones: [], total: 0 });
  });

  it('surfaces a BackendError as a JSON response with the same status', async () => {
    resolveSessionMock.mockResolvedValue({ accessToken: 'jwt', org: 'org-1', newTokens: null });
    vi.mocked(backendFetch).mockRejectedValue(new BackendError(404, { message: 'not found' }));

    const response = await proxyToBackend('http://svc', '/api/v1/zones/missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: 'not found' });
  });
});
