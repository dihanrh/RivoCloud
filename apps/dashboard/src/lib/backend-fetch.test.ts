import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendFetch, BackendError } from './backend-fetch';

describe('backendFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a bearer token and returns the parsed JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await backendFetch('http://svc', '/api/v1/thing', { accessToken: 'jwt-123' });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://svc/api/v1/thing');
    expect(init.headers.Authorization).toBe('Bearer jwt-123');
  });

  it('throws BackendError with the status and parsed body on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'nope' }), { status: 403 })),
    );

    await expect(backendFetch('http://svc', '/api/v1/thing')).rejects.toMatchObject({
      status: 403,
      body: { message: 'nope' },
    });
  });

  it('returns null for an empty response body', async () => {
    // Node's native Response constructor rejects a non-null body (even '') on a
    // null-body status like 204 per the Fetch spec, so use `null` here instead of
    // the brief's literal `''` — the resulting empty text() still exercises the
    // same "empty body -> null" branch in backendFetch.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await backendFetch('http://svc', '/api/v1/thing')).toBeNull();
  });
});
