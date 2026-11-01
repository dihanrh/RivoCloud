'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BarChart3, ChevronRight, Link2, Settings, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';
import { StatusDot } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { RelativeTime } from '@/components/ui/relative-time';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalyticsOverview } from '@/hooks/use-analytics';
import { useDomains } from '@/hooks/use-domains';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { formatBytes, formatNumber, formatPercent } from '@/lib/format';
import type { Zone } from '@/lib/types';
import { ORIGIN_PROTOCOL_LABEL, formatTtl } from './format';
import { PurgeEverythingButton } from './purge-cache';
import { EdgeHostname, ReadOnlyNote, ZoneHeader } from './zone-shell';

const DAY_MS = 24 * 60 * 60 * 1000;

export function ZoneOverview({ zone }: { zone: Zone }) {
  const { canPurge, canWrite } = useZonePermissions();

  return (
    <div>
      <ZoneHeader
        zone={zone}
        description={<EdgeHostname zone={zone} />}
        actions={
          canPurge ? (
            <PurgeEverythingButton zoneId={zone.id} zoneName={zone.name} />
          ) : !canWrite ? (
            <ReadOnlyNote />
          ) : undefined
        }
      />

      <QuickStats zoneId={zone.id} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Summary zone={zone} />

        <Card className="self-start">
          <CardHeader className="pb-2">
            <CardTitle>Configure</CardTitle>
          </CardHeader>
          <nav aria-label="Website sections" className="flex flex-col px-2 pb-2">
            <QuickLink icon={BarChart3} href={`/zones/${zone.id}/analytics`} label="Analytics" hint="Traffic, cache ratio, and latency" />
            <QuickLink icon={Zap} href={`/zones/${zone.id}/caching`} label="Caching" hint="Purge, cache rules, and TTLs" />
            <QuickLink icon={Link2} href={`/zones/${zone.id}/domains`} label="Custom domains" hint="Serve from your own hostname" />
            <QuickLink icon={ShieldCheck} href={`/zones/${zone.id}/security`} label="Security" hint="Signed URLs" />
            <QuickLink icon={Settings} href={`/zones/${zone.id}/settings`} label="Settings" hint="Name, origin, pause, delete" />
          </nav>
        </Card>
      </div>
    </div>
  );
}

function QuickLink({ icon: Icon, href, label, hint }: { icon: LucideIcon; href: string; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-foreground group-hover:text-primary">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

function QuickStats({ zoneId }: { zoneId: string }) {
  // Fix the window once per mount so the query key is stable.
  const [range] = useState(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - DAY_MS).toISOString(), to: to.toISOString() };
  });
  const { data, isLoading, error } = useAnalyticsOverview({ zoneId, ...range });

  const stats = [
    { label: 'Requests', value: data ? formatNumber(data.requests) : '—' },
    { label: 'Bandwidth', value: data ? formatBytes(Math.round(data.bytesSent)) : '—' },
    { label: 'Cache hit ratio', value: data ? formatPercent(data.hitRatio) : '—' },
  ];

  return (
    <section aria-labelledby="quick-stats-title">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="quick-stats-title" className="text-[13px] font-semibold text-muted-foreground">
          Last 24 hours
        </h2>
        <Link href={`/zones/${zoneId}/analytics`} className="text-[13px] text-primary hover:underline">
          View analytics
        </Link>
      </div>
      <Card className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {stats.map((stat) => (
          <div key={stat.label} className="px-5 py-4">
            <p className="text-[13px] text-muted-foreground">{stat.label}</p>
            {isLoading ? (
              <Skeleton className="mt-1.5 h-7 w-24" />
            ) : (
              <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
            )}
          </div>
        ))}
      </Card>
      {error && <p className="mt-2 text-xs text-muted-foreground">Traffic stats are unavailable right now.</p>}
    </section>
  );
}

function Summary({ zone }: { zone: Zone }) {
  const { data: domains, isLoading } = useDomains(zone.id);
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Status',
      value: <StatusDot tone={zone.enabled ? 'success' : 'muted'}>{zone.enabled ? 'Active' : 'Paused'}</StatusDot>,
    },
    { label: 'Origin', value: <span className="break-all">{zone.originUrl}</span> },
    { label: 'Origin protocol', value: ORIGIN_PROTOCOL_LABEL[zone.originProtocol] ?? zone.originProtocol },
    { label: 'Edge cache TTL', value: formatTtl(zone.cacheTtl) },
    { label: 'Browser cache TTL', value: formatTtl(zone.browserTtl) },
    {
      label: 'Custom domains',
      value: isLoading ? (
        <Skeleton className="h-4 w-8" />
      ) : (
        <Link href={`/zones/${zone.id}/domains`} className="text-primary hover:underline">
          {formatNumber(domains?.length ?? 0)}
        </Link>
      ),
    },
    { label: 'Signed URLs', value: zone.signedUrlsRequired ? 'Required' : 'Not required' },
    { label: 'Created', value: <RelativeTime value={zone.createdAt} /> },
  ];

  return (
    <Card className="self-start">
      <CardHeader className="pb-3">
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <dl className="border-t border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-4 border-b border-border px-5 py-2.5 text-[13px] last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)]"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
