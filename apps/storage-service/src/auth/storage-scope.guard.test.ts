import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { StorageScopeGuard } from './storage-scope.guard.js';
import type { CombinedAuthContext } from './auth-context.decorator.js';

function contextWith(auth: CombinedAuthContext, action: string | undefined) {
  const reflector = { get: () => action } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('StorageScopeGuard', () => {
  it('allows any request when the handler has no @RequireStorageScope', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, undefined);
    expect(new StorageScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows a developer JWT to write', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'developer' };
    const { context, reflector } = contextWith(auth, 'write');
    expect(new StorageScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects a viewer JWT trying to write', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'write');
    expect(() => new StorageScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows any JWT role to read', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'read');
    expect(new StorageScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows an API key with the storage:read scope to read', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['storage:read'] };
    const { context, reflector } = contextWith(auth, 'read');
    expect(new StorageScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects an API key missing the storage:delete scope', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['storage:read'] };
    const { context, reflector } = contextWith(auth, 'delete');
    expect(() => new StorageScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });
});
