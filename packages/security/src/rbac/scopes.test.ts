import { describe, expect, it } from 'vitest';
import { API_KEY_SCOPES, isOrgRole, scopesAllowedForRole } from './scopes.js';

describe('scopesAllowedForRole', () => {
  it('gives viewer read-only scopes', () => {
    expect(scopesAllowedForRole('viewer')).toEqual(['zone:read', 'storage:read', 'analytics:read']);
  });

  it('gives developer every scope except billing:read', () => {
    expect(scopesAllowedForRole('developer')).toEqual(API_KEY_SCOPES.filter((s) => s !== 'billing:read'));
  });

  it('gives owner and admin all 9 scopes', () => {
    expect(scopesAllowedForRole('owner')).toHaveLength(9);
    expect(scopesAllowedForRole('admin')).toEqual([...API_KEY_SCOPES]);
  });
});

describe('isOrgRole', () => {
  it('rejects unknown roles and accepts known ones', () => {
    expect(isOrgRole('superuser')).toBe(false);
    expect(isOrgRole('viewer')).toBe(true);
  });
});
