import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SecurityAuthContext } from '@rivocloud/security';

export type CombinedAuthContext = SecurityAuthContext;

export const AuthCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): CombinedAuthContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.auth;
});
