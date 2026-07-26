import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthContext {
  userId: string;
  orgId: string | null;
  role: string | null;
}

export const AuthCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.auth;
});
