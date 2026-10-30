import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { SecurityAuthContext } from './auth-context.js';
import { isOrgRole, scopesAllowedForRole, type ApiKeyScope } from './scopes.js';

export const REQUIRED_SCOPE_KEY = 'requiredScope';
export const RequireScope = (scope: ApiKeyScope) => SetMetadata(REQUIRED_SCOPE_KEY, scope);

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(REQUIRED_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Deny by default: a route behind this guard must declare its scope.
    if (!required) {
      throw new ForbiddenException('Route has no scope requirement');
    }
    const auth: SecurityAuthContext = context.switchToHttp().getRequest().auth;

    if (auth.type === 'api_key') {
      if (!auth.permissions?.includes(required)) {
        throw new ForbiddenException(`API key is missing the "${required}" scope`);
      }
      return true;
    }

    if (!auth.role || !isOrgRole(auth.role) || !scopesAllowedForRole(auth.role).includes(required)) {
      throw new ForbiddenException(`Role "${auth.role}" lacks the "${required}" permission`);
    }
    return true;
  }
}
