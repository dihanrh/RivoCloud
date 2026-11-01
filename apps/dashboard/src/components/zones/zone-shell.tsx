'use client';

import Link from 'next/link';
import { ArrowLeft, Eye, Globe, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useMounted } from '@/hooks/use-mounted';
import { useZone } from '@/hooks/use-zone';
import { ApiError } from '@/lib/http';
import type { Zone } from '@/lib/types';
import { cn } from '@/lib/utils';
import { zoneHostname } from '@/lib/zone-hostname';
import { ZonePageSkeleton } from './zone-skeletons';

/**
 * Loads a website and renders its page, or the loading / not found / error
 * state. Every page under /zones/[zoneId] goes through this.
 */
export function ZoneGate({ zoneId, children }: { zoneId: string; children: (zone: Zone) => React.ReactNode }) {
  const { data: zone, isLoading, error, refetch, isRefetching } = useZone(zoneId);
  // The shell may already have this website cached when the page hydrates; render the
  // skeleton (what the server rendered) until mounted to avoid a hydration mismatch.
  const mounted = useMounted();

  if (!mounted || isLoading) return <ZonePageSkeleton />;

  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return <ZoneNotFound />;
  }
  if (error) return <ZoneLoadError onRetry={() => void refetch()} retrying={isRefetching} />;
  if (!zone) return <ZoneNotFound />;

  return <>{children(zone)}</>;
}

export function ZoneNotFound() {
  return (
    <div>
      <PageHeader title="Website not found" crumbs={[{ label: 'Websites', href: '/zones' }, { label: 'Not found' }]} />
      <Card>
        <EmptyState
          icon={Globe}
          title="We couldn't find that website"
          description="It may have been deleted, or it belongs to a different account."
          action={
            <Button asChild variant="secondary">
              <Link href="/zones">
                <ArrowLeft /> Back to websites
              </Link>
            </Button>
          }
        />
      </Card>
    </div>
  );
}

export function ZoneLoadError({ onRetry, retrying }: { onRetry?: () => void; retrying?: boolean }) {
  return (
    <div>
      <PageHeader title="Website" crumbs={[{ label: 'Websites', href: '/zones' }, { label: 'Error' }]} />
      <div className="flex flex-col items-start gap-3">
        <ErrorBanner>Could not load this website. Check your connection and try again.</ErrorBanner>
        {onRetry && (
          <Button variant="secondary" size="sm" leftIcon={<RotateCw />} onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        )}
      </div>
    </div>
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
export function EdgeHostname({ zone, className }: { zone: Pick<Zone, 'slug' | 'id'>; className?: string }) {
  const hostname = zoneHostname(zone);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      <span className="break-all font-mono text-[13px] text-foreground">{hostname}</span>
      <CopyButton value={hostname} label="Copy edge hostname" />
    </span>
  );
}

/**
 * Subtle note shown (usually in the page header's action slot) when the
 * member's role hides every action on the page.
 */
export function ReadOnlyNote({ children = 'View only', className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <Eye className="h-3.5 w-3.5" aria-hidden />
      {children}
    </span>
  );
}
