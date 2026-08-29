import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ZoneScopeGuard } from './zone-scope.guard.js';
import type { CombinedAuthContext } from './auth-context.decorator.js';

function contextWith(auth: CombinedAuthContext, action: string | undefined) {
  const reflector = { get: () => action } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('ZoneScopeGuard', () => {
  it('allows any request when the handler has no @RequireZoneScope', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, undefined);
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows a developer JWT to write', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'developer' };
    const { context, reflector } = contextWith(auth, 'write');
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects a viewer JWT trying to write', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'write');
    expect(() => new ZoneScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows any JWT role to read', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'read');
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows an API key with the zone:read scope to read', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['zone:read'] };
    const { context, reflector } = contextWith(auth, 'read');
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects an API key missing the zone:delete scope', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['zone:read'] };
    const { context, reflector } = contextWith(auth, 'delete');
    expect(() => new ZoneScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows a developer role to invalidate', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'developer' };
    const { context, reflector } = contextWith(auth, 'invalidate');
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects a viewer role trying to invalidate', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'invalidate');
    expect(() => new ZoneScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });

  it('requires the cache:invalidate scope (not zone:invalidate) for an API key', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['zone:read'] };
    const { context, reflector } = contextWith(auth, 'invalidate');
    expect(() => new ZoneScopeGuard(reflector).canActivate(context)).toThrow('cache:invalidate');
  });

  it('allows an API key with the cache:invalidate scope', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['cache:invalidate'] };
    const { context, reflector } = contextWith(auth, 'invalidate');
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });
});
