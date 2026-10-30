'use client';

import { useMe } from './use-me';
import { scopesAllowedForRole } from '@/lib/rbac';

export interface ZonePermissions {
  canWrite: boolean;
  canPurge: boolean;
  canDelete: boolean;
}

// What the signed-in member may change on a website. The backend enforces the
// same scopes; this only keeps the UI from offering actions that would 403.
// Until the role is known, nothing is offered.
export function useZonePermissions(): ZonePermissions {
  const { data: me } = useMe();
  const scopes = me?.role ? scopesAllowedForRole(me.role) : [];
  return {
    canWrite: scopes.includes('zone:write'),
    canPurge: scopes.includes('cache:invalidate'),
    canDelete: scopes.includes('zone:delete'),
  };
}
