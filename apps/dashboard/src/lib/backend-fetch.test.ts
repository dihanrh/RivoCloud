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

  it('sends caller-supplied forwarded headers alongside Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await backendFetch('http://svc', '/api/v1/thing', {
      accessToken: 'jwt-123',
      headers: { 'X-Forwarded-For': '203.0.113.9', 'User-Agent': 'TestAgent/1.0' },
    });

    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer jwt-123',
      'X-Forwarded-For': '203.0.113.9',
      'User-Agent': 'TestAgent/1.0',
      'Content-Type': 'application/json',
    });
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

  it('falls back to the raw text when a non-2xx response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })),
    );

    const err = await backendFetch('http://svc', '/api/v1/thing').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ status: 502, body: '<html>Bad Gateway</html>' });
  });

  it('throws a BackendError with status 502 when the fetch call itself fails (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const err = await backendFetch('http://svc', '/api/v1/thing').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ status: 502, body: { message: 'Unable to reach backend service' } });
  });
});

describe('backendFetch in demo mode', () => {
  afterEach(() => {
    delete process.env.RIVO_DEMO_BACKEND;
    vi.unstubAllGlobals();
  });

  it('answers from the in-memory demo backend without touching the network', async () => {
    process.env.RIVO_DEMO_BACKEND = 'mock';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const tokens = (await backendFetch('http://mock.identity', '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@demo.rivo', password: 'DemoPass123!' }),
    })) as { accessToken: string };
    expect(tokens.accessToken.split('.')).toHaveLength(3);

    await expect(
      backendFetch('http://mock.cdn', '/api/v1/zones', { accessToken: 'not-a-token' }),
    ).rejects.toMatchObject({ status: 401, body: { statusCode: 401 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
