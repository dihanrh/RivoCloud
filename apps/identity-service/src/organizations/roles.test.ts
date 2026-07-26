import { describe, expect, it } from 'vitest';
import { scopesAllowedForRole } from './roles.js';

describe('scopesAllowedForRole', () => {
  it('grants owners every scope', () => {
    expect(scopesAllowedForRole('owner')).toContain('billing:read');
    expect(scopesAllowedForRole('owner')).toContain('zone:delete');
  });

  it('grants admins every scope, matching the EDD table (billing: Read)', () => {
    expect(scopesAllowedForRole('admin')).toContain('billing:read');
  });

  it('denies developers billing:read but grants zone/storage/cache/analytics scopes', () => {
    const scopes = scopesAllowedForRole('developer');
    expect(scopes).not.toContain('billing:read');
    expect(scopes).toContain('zone:write');
    expect(scopes).toContain('cache:invalidate');
    expect(scopes).toContain('storage:delete');
    expect(scopes).toContain('analytics:read');
  });

  it('grants viewers only read scopes', () => {
    const scopes = scopesAllowedForRole('viewer');
    expect(scopes).toEqual(['zone:read', 'storage:read', 'analytics:read']);
  });
});
