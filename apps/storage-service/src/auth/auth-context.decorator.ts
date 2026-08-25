import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CombinedAuthContext {
  type: 'jwt' | 'api_key';
  userId: string | null;
  orgId: string | null;
  role: string | null;
  apiKeyId?: string;
  permissions?: string[];
}

export const AuthCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): CombinedAuthContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.auth;
});
