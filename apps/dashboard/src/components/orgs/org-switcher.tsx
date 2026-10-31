'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useMounted } from '@/hooks/use-mounted';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelectOrg } from '@/hooks/use-select-org';
import { formatDate } from '@/lib/format';
import { errorMessage } from '@/lib/http';
import { cn } from '@/lib/utils';

const PALETTE = ['#d6246a', '#5b2a8c', '#c75f00', '#1e7d3a', '#1f6feb', '#8a3ffc'];

function OrgMark({ name }: { name: string }) {
  const hash = Array.from(name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white"
      style={{ background: PALETTE[hash % PALETTE.length] }}
    >
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

export function OrgSwitcher() {
  const router = useRouter();
  const toast = useToast();
  const mounted = useMounted();
  const { data: orgs, isLoading, error, refetch } = useOrgs();
  const selectOrg = useSelectOrg();
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  async function pick(orgId: string) {
    setPickError(null);
    setPickingId(orgId);
    try {
      await selectOrg.mutateAsync(orgId);
      router.push('/dashboard');
    } catch (err) {
      setPickingId(null);
      const message = errorMessage(err, 'Could not open that account. Try again.');
      setPickError(message);
      toast.error('Could not open the account', message);
    }
  }

  if (!mounted || isLoading) {
    return (
      <div role="status" aria-label="Loading accounts" className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBanner>Could not load your accounts.</ErrorBanner>
        <Button variant="secondary" onClick={() => void refetch()} className="self-start">
          Retry
        </Button>
      </div>
    );
  }
  if (!orgs || orgs.length === 0) {
    return <EmptyState icon={Building2} title="No accounts yet" description="Create an account to add websites and buckets." className="py-6" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {pickError && <ErrorBanner>{pickError}</ErrorBanner>}
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[var(--radius)] border border-border" aria-label="Accounts">
        {orgs.map((org) => {
          const picking = pickingId === org.id;
          return (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => void pick(org.id)}
                disabled={pickingId !== null}
                aria-busy={picking || undefined}
                className={cn(
                  'group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-default',
                  pickingId !== null && !picking && 'opacity-60',
                )}
              >
                <OrgMark name={org.name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-semibold">{org.name}</span>
                  <span className="truncate text-xs text-muted-foreground">Created {formatDate(org.createdAt)}</span>
                </span>
                {picking ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
                ) : (
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
