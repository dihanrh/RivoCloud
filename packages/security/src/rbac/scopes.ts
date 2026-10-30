export const ORG_ROLES = ['owner', 'admin', 'developer', 'viewer'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const API_KEY_SCOPES = [
  'zone:read',
  'zone:write',
  'zone:delete',
  'cache:invalidate',
  'storage:read',
  'storage:write',
  'storage:delete',
  'analytics:read',
  'billing:read',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const FULL_SCOPES: ApiKeyScope[] = [...API_KEY_SCOPES];
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
  owner: FULL_SCOPES,
  admin: FULL_SCOPES,
  developer: DEVELOPER_SCOPES,
  viewer: VIEWER_SCOPES,
};

export function scopesAllowedForRole(role: OrgRole): ApiKeyScope[] {
  return ROLE_SCOPES[role];
}

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}
