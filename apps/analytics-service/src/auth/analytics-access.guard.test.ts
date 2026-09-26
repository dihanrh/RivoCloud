import { describe, expect, it } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AnalyticsAccessGuard } from './analytics-access.guard.js';
import type { CombinedAuthContext } from './auth-context.decorator.js';

function makeContext(auth: CombinedAuthContext): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
}

describe('AnalyticsAccessGuard', () => {
  const guard = new AnalyticsAccessGuard();

  it('allows an api_key with zone:read', () => {
    const context = makeContext({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, permissions: ['zone:read'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects an api_key missing zone:read', () => {
    const context = makeContext({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, permissions: [] });
    expect(() => guard.canActivate(context)).toThrow('API key is missing the "zone:read" scope');
  });

  it('allows a jwt with a viewer role', () => {
    const context = makeContext({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a jwt with no role', () => {
    const context = makeContext({ type: 'jwt', userId: 'u1', orgId: 'o1', role: null });
    expect(() => guard.canActivate(context)).toThrow(/Requires one of roles/);
  });
});
