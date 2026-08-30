import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { CombinedAuthContext } from './auth-context.decorator.js';

// Every analytics endpoint is read-only, so unlike cdn-service's
// ZoneScopeGuard (which varies by action), this guard only ever checks the
// read-equivalent permission/role — mirroring
// apps/cdn-service/src/auth/zone-scope.guard.ts's 'read' case exactly.
const READ_ALLOWED_ROLES = ['owner', 'admin', 'developer', 'viewer'];

@Injectable()
export class AnalyticsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const auth: CombinedAuthContext = request.auth;

    if (auth.type === 'api_key') {
      if (!auth.permissions?.includes('zone:read')) {
        throw new ForbiddenException('API key is missing the "zone:read" scope');
      }
      return true;
    }

    if (!auth.role || !READ_ALLOWED_ROLES.includes(auth.role)) {
      throw new ForbiddenException(`Requires one of roles: ${READ_ALLOWED_ROLES.join(', ')}`);
    }
    return true;
  }
}
