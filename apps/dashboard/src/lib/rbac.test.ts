import { describe, expect, it } from 'vitest';
import { API_KEY_SCOPES, scopesAllowedForRole, canManageMembers, canChangeRoles, canViewAuditLog } from './rbac';
import * as pkg from '../../../../packages/security/src/rbac/scopes';

describe('rbac', () => {
  it('matches the security package', () => {
    expect([...API_KEY_SCOPES]).toEqual([...pkg.API_KEY_SCOPES]);
    for (const role of pkg.ORG_ROLES) {
      expect(scopesAllowedForRole(role)).toEqual(pkg.scopesAllowedForRole(role));
    }
  });

  it('gates member management, role changes, and audit log by role', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('admin')).toBe(true);
    expect(canManageMembers('developer')).toBe(false);
    expect(canManageMembers(null)).toBe(false);
    expect(canChangeRoles('owner')).toBe(true);
    expect(canChangeRoles('admin')).toBe(false);
    expect(canViewAuditLog('admin')).toBe(true);
    expect(canViewAuditLog('viewer')).toBe(false);
  });
});
