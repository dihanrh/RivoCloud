import type { OrgRole } from '@rivocloud/security';

/** Roles that member-management endpoints may assign. `owner` is never assignable (no ownership transfer). */
export const ASSIGNABLE_ROLES = ['admin', 'developer', 'viewer'] as const satisfies readonly OrgRole[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
