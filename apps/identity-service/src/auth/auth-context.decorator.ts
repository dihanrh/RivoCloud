import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OrgRole } from '@rivocloud/security';

/** Set by JwtOnlyGuard. `role` is the caller's live role in `orgId` (null when no org is selected). */
export interface AuthContext {
  type: 'jwt';
  userId: string;
  orgId: string | null;
  role: OrgRole | null;
}

export const AuthCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.auth;
});
