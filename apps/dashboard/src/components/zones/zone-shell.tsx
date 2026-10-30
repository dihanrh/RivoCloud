'use client';

import Link from 'next/link';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useZone } from '@/hooks/use-zone';
import { ApiError } from '@/lib/http';
import type { Zone } from '@/lib/types';
import { zoneHostname } from '@/lib/zone-hostname';
import { CopyButton } from './copy-button';

/**
 * Loads a website and renders its page, or the loading / not found / error
 * state. Every page under /zones/[zoneId] goes through this.
 */
export function ZoneGate({ zoneId, children }: { zoneId: string; children: (zone: Zone) => React.ReactNode }) {
  const { data: zone, isLoading, error } = useZone(zoneId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return <ZoneNotFound />;
  }
  if (error) {
    return <ErrorBanner>Could not load this website. Refresh the page to try again.</ErrorBanner>;
  }
  if (!zone) return <ZoneNotFound />;

  return <>{children(zone)}</>;
}

function ZoneNotFound() {
  return (
    <EmptyState
      icon={Globe}
      title="Website not found"
      description="It may have been deleted, or it belongs to a different account."
      action={
        <Button asChild variant="outline">
          <Link href="/zones">Back to websites</Link>
        </Button>
      }
    />
  );
}

/** Page header for a website section: crumbs Websites › name › section. */
export function ZoneHeader({
  zone,
  section,
  description,
  actions,
}: {
  zone: Zone;
  section?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const crumbs = [{ label: 'Websites', href: '/zones' }, section ? { label: zone.name, href: `/zones/${zone.id}` } : { label: zone.name }];
  if (section) crumbs.push({ label: section });
  return <PageHeader title={section ?? zone.name} crumbs={crumbs} description={description} actions={actions} />;
}

/** The edge hostname in mono text with a copy button. */
export function EdgeHostname({ zone }: { zone: Pick<Zone, 'slug' | 'id'> }) {
  const hostname = zoneHostname(zone);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="break-all font-mono text-[13px] text-foreground">{hostname}</span>
      <CopyButton value={hostname} label="Copy edge hostname" />
    </span>
  );
}
