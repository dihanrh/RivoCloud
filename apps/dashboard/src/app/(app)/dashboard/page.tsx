'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, BarChart3, Copy, Database, ExternalLink, Globe, Plus, UserPlus } from 'lucide-react';
import { AnalyticsKpis } from '@/components/analytics/analytics-kpis';
import { GetStartedCard } from '@/components/settings/get-started-card';
import { UserAvatar } from '@/components/settings/user-avatar';
import { ROLE_NAME } from '@/components/settings/members-panel';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, RowActionsMenu, TablePrimaryLink, type DataTableColumn } from '@/components/ui/data-table';
import { MenuItem, MenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { RelativeTime } from '@/components/ui/relative-time';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useBuckets } from '@/hooks/use-buckets';
import { useMe } from '@/hooks/use-me';
import { useMembers } from '@/hooks/use-members';
import { useOrgs } from '@/hooks/use-orgs';
import { useZones } from '@/hooks/use-zones';
import { canManageMembers } from '@/lib/rbac';
import type { OrgRole, Zone } from '@/lib/types';
import { zoneHostname } from '@/lib/zone-hostname';
import { useMounted } from '@/hooks/use-mounted';
import Loading from './loading';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function AccountHomePage() {
  const mounted = useMounted();
  const { data: me } = useMe();
  const { data: orgs } = useOrgs();
  const accountName = orgs?.find((org) => org.id === me?.orgId)?.name;
  const canWrite = !!me?.role && me.role !== 'viewer';
  const firstName = me?.name?.split(' ')[0];

  // Fixed once per mount so the query key stays stable between renders.
  const params = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - DAY_MS).toISOString(), to: to.toISOString() };
  }, []);

  // Render the route's skeleton until hydrated; see useMounted.
  if (!mounted) return <Loading />;

  return (
    <>
      <PageHeader
        title="Account home"
        description={
          accountName ? (
            <>
              {firstName ? `Welcome back, ${firstName}. ` : ''}Here&apos;s how <span className="font-medium text-foreground">{accountName}</span>{' '}
              is doing.
            </>
          ) : (
            <span aria-hidden className="inline-block h-4 w-64 max-w-full animate-pulse rounded-md bg-[#e9ebee] align-middle" />
          )
        }
        actions={
          canWrite ? (
            <Button asChild>
              <Link href="/zones?create=1">
<Plus aria-hidden />
Add a website</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6">
        {me?.orgId && <GetStartedCard orgId={me.orgId} role={me.role} />}
        <section aria-labelledby="traffic-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="traffic-heading" className="text-base font-semibold">
              Traffic, last 24 hours
            </h2>
            <Button asChild variant="link" size="sm">
              <Link href="/analytics">
Analytics
<ArrowRight aria-hidden />
</Link>
            </Button>
          </div>
          <AnalyticsKpis params={params} hint="Last 24 hours" showLatency={false} />
        </section>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <WebsitesPanel canWrite={canWrite} />
          <div className="flex flex-col gap-6">
            <StoragePanel />
            {me?.orgId && <TeamPanel orgId={me.orgId} role={me.role} />}
          </div>
        </div>
      </div>
    </>
  );
}

function PanelHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <Button asChild variant="link" size="sm">
        <Link href={href}>
{linkLabel}
<ArrowRight aria-hidden />
</Link>
      </Button>
    </div>
  );
}

function WebsitesPanel({ canWrite }: { canWrite: boolean }) {
  const toast = useToast();
  const { data, isLoading, error, refetch } = useZones();
  const zones = data?.zones;

  async function copyHostname(zone: Zone) {
    try {
      await navigator.clipboard.writeText(zoneHostname(zone));
      toast.success('Hostname copied', zoneHostname(zone));
    } catch {
      toast.error('Could not copy', 'Select the hostname and copy it manually.');
    }
  }

  const columns: DataTableColumn<Zone>[] = [
    {
      id: 'name',
      header: 'Website',
      cell: (z) => (
        <TablePrimaryLink href={`/zones/${z.id}`} sub={<span className="font-mono">{zoneHostname(z)}</span>}>
          {z.name}
        </TablePrimaryLink>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (z) => <StatusDot tone={z.enabled ? 'success' : 'muted'}>{z.enabled ? 'Active' : 'Paused'}</StatusDot>,
      hideBelow: 'sm',
    },
    {
      id: 'updated',
      header: 'Updated',
      cell: (z) => <RelativeTime value={z.updatedAt} className="whitespace-nowrap text-muted-foreground" />,
      align: 'right',
      hideBelow: 'md',
    },
  ];

  return (
    <DataTable
      aria-label="Websites"
      className="self-start"
      columns={columns}
      rows={zones?.slice(0, 5)}
      getRowKey={(z) => z.id}
      loading={isLoading}
      skeletonRows={4}
      error={error ? 'Could not load your websites.' : null}
      onRetry={() => void refetch()}
      toolbar={<PanelHeader title="Websites" href="/zones" linkLabel="View all" />}
      empty={
        <EmptyState
          icon={Globe}
          title="No websites yet"
          description="Add a website to serve it through the CDN and see its traffic here."
          action={
            canWrite ? (
              <Button asChild>
                <Link href="/zones?create=1">
<Plus aria-hidden />
Add a website</Link>
              </Button>
            ) : undefined
          }
        />
      }
      footer={
        zones && zones.length > 5 ? (
          <Link href="/zones" className="text-primary hover:underline">
            {zones.length - 5} more {zones.length - 5 === 1 ? 'website' : 'websites'}
          </Link>
        ) : undefined
      }
      rowActions={(z) => (
        <RowActionsMenu label={`Actions for ${z.name}`}>
          <MenuItem asChild>
            <Link href={`/zones/${z.id}`}>
              <ExternalLink className="text-muted-foreground" aria-hidden />
              Open
            </Link>
          </MenuItem>
          <MenuItem asChild>
            <Link href={`/zones/${z.id}/analytics`}>
              <BarChart3 className="text-muted-foreground" aria-hidden />
              Analytics
            </Link>
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Copy />} onSelect={() => void copyHostname(z)}>
            Copy hostname
          </MenuItem>
        </RowActionsMenu>
      )}
    />
  );
}

function SummaryStat({ value, noun, loading }: { value: number | undefined; noun: [string, string]; loading: boolean }) {
  if (loading) return <Skeleton className="h-8 w-28" />;
  return (
    <p className="text-[13px] text-muted-foreground">
      <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value ?? 0}</span>{' '}
      {value === 1 ? noun[0] : noun[1]}
    </p>
  );
}

function StoragePanel() {
  const { data, isLoading, error } = useBuckets();
  const buckets = data?.buckets ?? [];
  const publicCount = buckets.filter((b) => b.public).length;

  return (
    <Card className="overflow-hidden">
      <PanelHeader title="Storage" href="/storage" linkLabel="Open storage" />
      <div className="flex flex-col gap-3 px-4 pb-4">
        {error ? (
          <p className="text-[13px] text-destructive">Could not load your buckets.</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <SummaryStat value={data?.total} noun={['bucket', 'buckets']} loading={isLoading} />
              {!isLoading && buckets.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {buckets.length - publicCount} private · {publicCount} public
                </p>
              )}
            </div>
            {buckets.length > 0 && (
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border">
                {buckets.slice(0, 3).map((b) => (
                  <li key={b.id}>
                    <Link href={`/storage/${b.id}`} className="flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-muted">
                      <Database className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                      <Badge variant={b.public ? 'warning' : 'secondary'}>{b.public ? 'Public' : 'Private'}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function TeamPanel({ orgId, role }: { orgId: string; role: OrgRole | null }) {
  const { data, isLoading, error } = useMembers(orgId);
  const members = data ?? [];
  const counts = members.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.role]: (acc[m.role] ?? 0) + 1 }), {});

  return (
    <Card className="overflow-hidden">
      <PanelHeader title="Team" href="/settings/members" linkLabel="Members" />
      <div className="flex flex-col gap-3 px-4 pb-4">
        {error ? (
          <p className="text-[13px] text-destructive">Could not load members.</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <SummaryStat value={data?.length} noun={['member', 'members']} loading={isLoading} />
              {members.length > 0 && (
                <div className="flex -space-x-1" aria-hidden>
                  {members.slice(0, 5).map((m) => (
                    <UserAvatar key={m.userId} name={m.user?.name} email={m.user?.email} className="h-8 w-8 text-[11px] ring-2 ring-background" />
                  ))}
                  {members.length > 5 && (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-background">
                      +{members.length - 5}
                    </span>
                  )}
                </div>
              )}
            </div>
            {members.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {(['owner', 'admin', 'developer', 'viewer'] as const)
                  .filter((r) => counts[r])
                  .map((r) => `${counts[r]} ${ROLE_NAME[r].toLowerCase()}${counts[r] === 1 ? '' : 's'}`)
                  .join(' · ')}
              </p>
            )}
            {canManageMembers(role) && (
              <Button asChild variant="secondary" size="sm" className="self-start">
                <Link href="/settings/members?invite=1">
<UserPlus aria-hidden />
Invite member</Link>
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
