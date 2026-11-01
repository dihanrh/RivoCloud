'use client';

import { useMe } from './use-me';
import { useMounted } from './use-mounted';
import { scopesAllowedForRole } from '@/lib/rbac';

export interface ZonePermissions {
  canWrite: boolean;
  canPurge: boolean;
  canDelete: boolean;
}

// What the signed-in member may change on a website. The backend enforces the
// same scopes; this only keeps the UI from offering actions that would 403.
// Until the role is known, nothing is offered. The role is also ignored while
// hydrating: the server never knows it, and a page that hydrates after the
// shell has already loaded /api/me would otherwise render different markup
// than the server did (React hydration error #418).
export function useZonePermissions(): ZonePermissions {
  const { data: me } = useMe();
  const mounted = useMounted();
  const scopes = mounted && me?.role ? scopesAllowedForRole(me.role) : [];
  return {
    canWrite: scopes.includes('zone:write'),
    canPurge: scopes.includes('cache:invalidate'),
    canDelete: scopes.includes('zone:delete'),
  };
}
