'use client';

import { useMemo, useState } from 'react';
import { Globe, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useZones } from '@/hooks/use-zones';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { CreateZoneDialog } from './create-zone-dialog';
import { ZoneList } from './zone-list';

export function WebsitesView() {
  const { data, isLoading, error } = useZones();
  const { canWrite } = useZonePermissions();
  const [query, setQuery] = useState('');

  const zones = useMemo(() => data?.zones ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => z.name.toLowerCase().includes(q) || z.originUrl.toLowerCase().includes(q));
  }, [zones, query]);

  return (
    <div>
      <PageHeader
        title="Websites"
        description="Each website pulls content from your origin and serves it from the edge cache."
        actions={canWrite ? <CreateZoneDialog /> : undefined}
      />

      {isLoading && <Skeleton className="h-48 w-full" />}
      {error && <ErrorBanner>Could not load your websites. Refresh the page to try again.</ErrorBanner>}

      {data && zones.length === 0 && (
        <Card>
          <EmptyState
            icon={Globe}
            title="Add your first website"
            description="Point us at your origin server and we will cache and serve its content from the edge."
            action={canWrite ? <CreateZoneDialog /> : undefined}
          />
        </Card>
      )}

      {zones.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Search websites"
              placeholder="Search by name or origin"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          {filtered.length > 0 ? (
            <ZoneList zones={filtered} />
          ) : (
            <Card>
              <EmptyState title="No websites match your search" description="Try a different name or origin." />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
