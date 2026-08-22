import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth-guard.js';
import type { IdentityClient } from './identity-client.js';

function contextWith(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; auth?: unknown } = { headers };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { context, request };
}

describe('AuthGuard', () => {
  it('rejects a request with neither credential, without calling IdentityClient', async () => {
    const identity = { verifyToken: vi.fn(), verifyApiKey: vi.fn() } as unknown as IdentityClient;
    const guard = new AuthGuard(identity);
    const { context } = contextWith({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(identity.verifyToken).not.toHaveBeenCalled();
    expect(identity.verifyApiKey).not.toHaveBeenCalled();
  });

  it('verifies a Bearer token and attaches the result to request.auth', async () => {
    const auth = { type: 'jwt' as const, userId: 'u1', orgId: 'o1', role: 'owner' };
    const identity = { verifyToken: vi.fn().mockResolvedValue(auth), verifyApiKey: vi.fn() } as unknown as IdentityClient;
    const guard = new AuthGuard(identity);
    const { context, request } = contextWith({ authorization: 'Bearer sometoken' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(identity.verifyToken).toHaveBeenCalledWith('sometoken');
    expect(request.auth).toEqual(auth);
  });

  it('verifies an X-API-Key header and attaches the result to request.auth', async () => {
    const auth = { type: 'api_key' as const, userId: null, orgId: 'o1', role: null, permissions: ['zone:read'] };
    const identity = { verifyToken: vi.fn(), verifyApiKey: vi.fn().mockResolvedValue(auth) } as unknown as IdentityClient;
    const guard = new AuthGuard(identity);
    const { context, request } = contextWith({ 'x-api-key': 'rc_sometoken' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(identity.verifyApiKey).toHaveBeenCalledWith('rc_sometoken');
    expect(request.auth).toEqual(auth);
  });

  it('propagates an IdentityClient rejection', async () => {
    const identity = {
      verifyToken: vi.fn().mockRejectedValue(new UnauthorizedException('Invalid or expired token')),
      verifyApiKey: vi.fn(),
    } as unknown as IdentityClient;
    const guard = new AuthGuard(identity);
    const { context } = contextWith({ authorization: 'Bearer badtoken' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
