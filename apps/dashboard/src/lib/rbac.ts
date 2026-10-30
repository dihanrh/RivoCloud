import type { ApiKeyScope, OrgRole } from './types';

// Duplicated from packages/security/src/rbac/scopes.ts, which is the source of
// truth. lib/rbac.test.ts compares the two so they cannot drift silently.
export const API_KEY_SCOPES: readonly ApiKeyScope[] = [
  'zone:read',
  'zone:write',
  'zone:delete',
  'cache:invalidate',
  'storage:read',
  'storage:write',
  'storage:delete',
  'analytics:read',
  'billing:read',
];

const DEVELOPER_SCOPES: ApiKeyScope[] = [
  'zone:read',
  'zone:write',
  'zone:delete',
  'cache:invalidate',
  'storage:read',
  'storage:write',
  'storage:delete',
  'analytics:read',
];
const VIEWER_SCOPES: ApiKeyScope[] = ['zone:read', 'storage:read', 'analytics:read'];

const ROLE_SCOPES: Record<OrgRole, ApiKeyScope[]> = {
  owner: [...API_KEY_SCOPES],
  admin: [...API_KEY_SCOPES],
  developer: DEVELOPER_SCOPES,
  viewer: VIEWER_SCOPES,
};

export function scopesAllowedForRole(role: OrgRole): ApiKeyScope[] {
  return ROLE_SCOPES[role];
}

type MaybeRole = OrgRole | string | null | undefined;

// Mirrors the identity-service member-management rules.
export function canManageMembers(role: MaybeRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canChangeRoles(role: MaybeRole): boolean {
  return role === 'owner';
}

export function canViewAuditLog(role: MaybeRole): boolean {
  return role === 'owner' || role === 'admin';
}
