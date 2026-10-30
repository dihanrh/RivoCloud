'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAnalyticsOverview } from '@/hooks/use-analytics';
import { useBuckets } from '@/hooks/use-buckets';
import { useMe } from '@/hooks/use-me';
import { useMembers } from '@/hooks/use-members';
import { useOrgs } from '@/hooks/use-orgs';
import { useZones } from '@/hooks/use-zones';
import { formatBytes } from '@/lib/format-bytes';
import { zoneHostname } from '@/lib/zone-hostname';

export default function AccountHomePage() {
  const { data: me } = useMe();
  const { data: orgs } = useOrgs();
  const accountName = orgs?.find((org) => org.id === me?.orgId)?.name;

  return (
    <>
      <PageHeader title="Account home" description={accountName} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WebsitesPanel />
        <div className="flex flex-col gap-6">
          <TrafficPanel />
          <StoragePanel />
          {me?.orgId && <TeamPanel orgId={me.orgId} />}
        </div>
      </div>
    </>
  );
}

function WebsitesPanel() {
  const { data, isLoading, error } = useZones();
  const zones = data?.zones ?? [];

  return (
    <Card className="self-start">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle>Websites</CardTitle>
        <div className="flex items-center gap-2">
          {zones.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/zones">View all</Link>
            </Button>
          )}
          <Button asChild size="sm">
            <Link href="/zones">Add a website</Link>
          </Button>
        </div>
      </CardHeader>
      {isLoading && (
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      )}
      {error && (
        <CardContent>
          <ErrorBanner>Could not load your websites. Refresh the page to try again.</ErrorBanner>
        </CardContent>
      )}
      {data && zones.length === 0 && (
        <EmptyState
          icon={Globe}
          title="No websites yet"
          description="Add a website to serve it through the CDN and see its traffic here."
          action={
            <Button asChild>
              <Link href="/zones">Add a website</Link>
            </Button>
          }
        />
      )}
      {zones.length > 0 && (
        <div className="border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Website</TableHead>
                <TableHead>Edge hostname</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.slice(0, 5).map((zone) => (
                <TableRow key={zone.id}>
                  <TableCell>
                    <Link href={`/zones/${zone.id}`} className="font-medium text-primary hover:underline">
                      {zone.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{zoneHostname(zone)}</TableCell>
                  <TableCell>
                    <Badge variant={zone.enabled ? 'success' : 'secondary'}>{zone.enabled ? 'Active' : 'Paused'}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function TrafficPanel() {
  // Fixed once per mount so the query key stays stable between renders.
  const params = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString(), to: to.toISOString() };
  }, []);
  const { data, isLoading, error } = useAnalyticsOverview(params);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle>Traffic, last 24 hours</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/analytics">Analytics</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-16 w-full" />}
        {error && <p className="text-[13px] text-destructive">Could not load traffic.</p>}
        {data && (
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Requests" value={data.requests.toLocaleString()} />
            <Stat label="Bandwidth" value={formatBytes(String(Math.round(data.bytesSent)))} />
            <Stat label="Cache hit ratio" value={`${Math.round(data.hitRatio * 100)}%`} />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function StoragePanel() {
  const { data, isLoading } = useBuckets();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle>Storage</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/storage">Open storage</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            <span className="text-xl font-semibold tabular-nums text-foreground">{data?.total ?? 0}</span>{' '}
            {data?.total === 1 ? 'bucket' : 'buckets'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TeamPanel({ orgId }: { orgId: string }) {
  const { data, isLoading } = useMembers(orgId);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle>Team</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/settings/members">Members</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            <span className="text-xl font-semibold tabular-nums text-foreground">{data?.length ?? 0}</span>{' '}
            {data?.length === 1 ? 'member' : 'members'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
