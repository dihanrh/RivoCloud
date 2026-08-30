import { describe, expect, it } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard.js';

function contextWithHeader(header: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-internal-secret': header } }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalAuthGuard', () => {
  const guard = new InternalAuthGuard({ INTERNAL_API_SECRET: 'correct-secret' } as never);

  it('allows a request with the correct secret', () => {
    expect(guard.canActivate(contextWithHeader('correct-secret'))).toBe(true);
  });

  it('rejects a request with the wrong secret', () => {
    expect(() => guard.canActivate(contextWithHeader('wrong-secret'))).toThrow(UnauthorizedException);
  });

  it('rejects a request with no secret header', () => {
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(UnauthorizedException);
  });
});
