import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth-guard.js';
import type { IdentityClient } from './identity-client.js';

function makeContext(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; auth?: unknown } = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext & { request: typeof request };
}

describe('AuthGuard', () => {
  it('resolves via API key when X-API-Key starts with rc_', async () => {
    const verifyApiKey = vi.fn().mockResolvedValue({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null });
    const guard = new AuthGuard({ verifyApiKey } as unknown as IdentityClient);
    const context = makeContext({ 'x-api-key': 'rc_live_abc' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyApiKey).toHaveBeenCalledWith('rc_live_abc');
  });

  it('resolves via bearer token when no X-API-Key is present', async () => {
    const verifyToken = vi.fn().mockResolvedValue({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'owner' });
    const guard = new AuthGuard({ verifyToken } as unknown as IdentityClient);
    const context = makeContext({ authorization: 'Bearer tok123' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('tok123');
  });

  it('throws when neither header is present', async () => {
    const guard = new AuthGuard({} as unknown as IdentityClient);
    const context = makeContext({});
    await expect(guard.canActivate(context)).rejects.toThrow('Missing Authorization bearer token or X-API-Key header');
  });
});
