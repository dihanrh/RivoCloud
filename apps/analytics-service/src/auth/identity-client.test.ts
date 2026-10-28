import { describe, expect, it, vi, afterEach } from 'vitest';
import { IdentityClient } from './identity-client.js';

describe('IdentityClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifyToken returns a jwt auth context on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: 'u1', orgId: 'o1', role: 'owner' }), { status: 200 })),
    );
    const client = new IdentityClient('http://identity', 'secret');
    const auth = await client.verifyToken('tok');
    expect(auth).toEqual({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'owner' });
  });

  it('verifyToken throws UnauthorizedException on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const client = new IdentityClient('http://identity', 'secret');
    await expect(client.verifyToken('bad')).rejects.toThrow('Invalid or expired token');
  });

  it('verifyApiKey returns an api_key auth context on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: 'u1', orgId: 'o1', apiKeyId: 'k1', permissions: ['zone:read'] }), { status: 200 })),
    );
    const client = new IdentityClient('http://identity', 'secret');
    const auth = await client.verifyApiKey('rc_key');
    expect(auth).toEqual({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, apiKeyId: 'k1', permissions: ['zone:read'] });
  });

  it('throws UnauthorizedException when the Identity Service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const client = new IdentityClient('http://identity', 'secret');
    await expect(client.verifyToken('tok')).rejects.toThrow('Identity Service unreachable');
  });
});
