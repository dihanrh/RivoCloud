import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequireScope, ScopeGuard } from './scope.guard.js';
import type { SecurityAuthContext } from './auth-context.js';

class Plain {
  noScope() {}
}

@RequireScope('zone:read')
class ClassScoped {
  inherits() {}

  @RequireScope('zone:write')
  overrides() {}
}

class WriteHandler {
  @RequireScope('zone:write')
  write() {}

  @RequireScope('zone:read')
  read() {}

  @RequireScope('billing:read')
  billing() {}
}

function contextFor(auth: SecurityAuthContext, cls: new () => object, method: string): ExecutionContext {
  return {
    getHandler: () => (cls.prototype as Record<string, () => void>)[method],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
}

const guard = new ScopeGuard(new Reflector());
const jwt = (role: string | null): SecurityAuthContext => ({ type: 'jwt', userId: 'u1', orgId: 'o1', role });

describe('ScopeGuard', () => {
  it('viewer JWT is allowed zone:read and denied zone:write', () => {
    expect(guard.canActivate(contextFor(jwt('viewer'), WriteHandler, 'read'))).toBe(true);
    const denied = () => guard.canActivate(contextFor(jwt('viewer'), WriteHandler, 'write'));
    expect(denied).toThrow(ForbiddenException);
    expect(denied).toThrow('Role "viewer" lacks the "zone:write" permission');
  });

  it('developer JWT is denied billing:read', () => {
    expect(() => guard.canActivate(contextFor(jwt('developer'), WriteHandler, 'billing'))).toThrow(ForbiddenException);
  });

  it('api_key passes only with the exact scope', () => {
    const key = (permissions: string[]): SecurityAuthContext => ({
      type: 'api_key', userId: null, orgId: 'o1', role: null, apiKeyId: 'k1', permissions,
    });
    expect(guard.canActivate(contextFor(key(['zone:write']), WriteHandler, 'write'))).toBe(true);
    const denied = () => guard.canActivate(contextFor(key(['zone:read']), WriteHandler, 'write'));
    expect(denied).toThrow(ForbiddenException);
    expect(denied).toThrow('API key is missing the "zone:write" scope');
  });

  it('a route with no RequireScope is denied', () => {
    const denied = () => guard.canActivate(contextFor(jwt('owner'), Plain, 'noScope'));
    expect(denied).toThrow(ForbiddenException);
    expect(denied).toThrow('Route has no scope requirement');
  });

  it('handler-level scope overrides class-level scope', () => {
    // class says zone:read (viewer ok), handler says zone:write (viewer denied)
    expect(guard.canActivate(contextFor(jwt('viewer'), ClassScoped, 'inherits'))).toBe(true);
    expect(() => guard.canActivate(contextFor(jwt('viewer'), ClassScoped, 'overrides'))).toThrow(
      'Role "viewer" lacks the "zone:write" permission',
    );
  });

  it('JWT with null role is denied', () => {
    expect(() => guard.canActivate(contextFor(jwt(null), WriteHandler, 'read'))).toThrow(ForbiddenException);
  });
});
