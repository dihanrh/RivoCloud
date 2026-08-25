import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CombinedAuthContext } from './auth-context.decorator.js';

export type StorageAction = 'read' | 'write' | 'delete';
export const STORAGE_SCOPE_KEY = 'storageScope';
export const RequireStorageScope = (action: StorageAction) => SetMetadata(STORAGE_SCOPE_KEY, action);

// Mirrors apps/identity-service/src/organizations/roles.ts's API_KEY_SCOPES /
// scopesAllowedForRole. Duplicated rather than imported across the service
// boundary (Design Decision 1/7) — keep these two in sync by hand until a
// third consumer justifies a shared package.
const ROLES_BY_ACTION: Record<StorageAction, string[]> = {
  read: ['owner', 'admin', 'developer', 'viewer'],
  write: ['owner', 'admin', 'developer'],
  delete: ['owner', 'admin', 'developer'],
};

@Injectable()
export class StorageScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const action = this.reflector.get<StorageAction | undefined>(STORAGE_SCOPE_KEY, context.getHandler());
    if (!action) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const auth: CombinedAuthContext = request.auth;

    if (auth.type === 'api_key') {
      const required = `storage:${action}`;
      if (!auth.permissions?.includes(required)) {
        throw new ForbiddenException(`API key is missing the "${required}" scope`);
      }
      return true;
    }

    const allowed = ROLES_BY_ACTION[action];
    if (!auth.role || !allowed.includes(auth.role)) {
      throw new ForbiddenException(`Requires one of roles: ${allowed.join(', ')}`);
    }
    return true;
  }
}
