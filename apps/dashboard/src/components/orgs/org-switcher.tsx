'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelectOrg } from '@/hooks/use-select-org';
import { errorMessage } from '@/lib/http';

export function OrgSwitcher() {
  const router = useRouter();
  const { data: orgs, isLoading } = useOrgs();
  const selectOrg = useSelectOrg();
  const [error, setError] = useState<string | null>(null);

  async function pick(orgId: string) {
    setError(null);
    try {
      await selectOrg.mutateAsync(orgId);
      router.push('/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Could not open that account. Try again.'));
    }
  }

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!orgs || orgs.length === 0) {
    return <EmptyState title="No accounts yet" description="Create an account to add websites and buckets." className="py-6" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius)] border border-border">
        {orgs.map((org) => (
          <li key={org.id}>
            <button
              type="button"
              onClick={() => void pick(org.id)}
              disabled={selectOrg.isPending}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-medium hover:bg-muted disabled:opacity-60"
            >
              <span className="truncate">{org.name}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
