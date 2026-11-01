'use client';

import { ErrorBanner } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import { useMounted } from '@/hooks/use-mounted';
import type { OrgRole } from '@/lib/types';

export interface SettingsMe {
  id: string;
  orgId: string;
  role: OrgRole | null;
}

/** Loads the current user and only renders its children once an account is selected. */
export function SettingsGate({ children }: { children: (me: SettingsMe) => React.ReactNode }) {
  const mounted = useMounted();
  const { data: me, isLoading, error } = useMe();

  // Skeleton until hydrated too: the shell may have /api/me cached already (see useMounted).
  if (!mounted || isLoading) return <SettingsTableSkeleton />;
  if (error || !me) return <ErrorBanner>Could not load your profile. Refresh the page to try again.</ErrorBanner>;
  if (!me.orgId) return <ErrorBanner>Select an account first, then come back to this page.</ErrorBanner>;

  return <>{children({ id: me.id, orgId: me.orgId, role: me.role })}</>;
}

/** Toolbar + table placeholder shared by the settings pages and their loading.tsx. */
export function SettingsTableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <Card role="status" aria-label="Loading" className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-3">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="hidden h-8 w-32 sm:block" />
      </div>
      <div className="border-t border-border">
        <TableSkeleton rows={rows} columns={columns} />
      </div>
    </Card>
  );
}
