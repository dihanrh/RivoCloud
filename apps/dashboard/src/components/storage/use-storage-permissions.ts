'use client';

import { useMe } from '@/hooks/use-me';
import { scopesAllowedForRole } from '@/lib/rbac';

export interface StoragePermissions {
  /** Known once the profile has loaded; until then nothing is offered. */
  ready: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

// Mirrors the backend's storage scopes so the UI only offers actions that won't 403.
export function useStoragePermissions(): StoragePermissions {
  const { data: me } = useMe();
  const scopes = me?.role ? scopesAllowedForRole(me.role) : [];
  return { ready: !!me, canWrite: scopes.includes('storage:write'), canDelete: scopes.includes('storage:delete') };
}
