'use client';

import { ErrorBanner } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import type { OrgRole } from '@/lib/types';

export interface SettingsMe {
  id: string;
  orgId: string;
  role: OrgRole | null;
}

/** Loads the current user and only renders its children once an account is selected. */
export function SettingsGate({ children }: { children: (me: SettingsMe) => React.ReactNode }) {
  const { data: me, isLoading, error } = useMe();

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !me) return <ErrorBanner>Could not load your profile. Refresh the page to try again.</ErrorBanner>;
  if (!me.orgId) return <ErrorBanner>Select an account first, then come back to this page.</ErrorBanner>;

  return <>{children({ id: me.id, orgId: me.orgId, role: me.role })}</>;
}
