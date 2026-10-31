'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Copy, ExternalLink, Globe, Pause, Play, Plus, Trash2, Zap } from 'lucide-react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable, TablePrimaryLink, TableToolbar, type DataTableColumn } from '@/components/ui/data-table';
import { MenuItem, MenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RelativeTime } from '@/components/ui/relative-time';
import { useToast } from '@/components/ui/toast';
import { useDeleteZone } from '@/hooks/use-delete-zone';
import { useUpdateZone } from '@/hooks/use-update-zone';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { useMounted } from '@/hooks/use-mounted';
import { useQuickActionParam } from '@/hooks/use-quick-action-param';
import { useZones } from '@/hooks/use-zones';
import { errorMessage } from '@/lib/http';
import type { Zone } from '@/lib/types';
import { zoneHostname } from '@/lib/zone-hostname';
import { CreateZoneDialog } from './create-zone-dialog';
import { copyToClipboard } from './menu-helpers';
import { ZoneRowMenu } from './row-menu';
import { ReadOnlyNote } from './zone-shell';

type StatusFilter = 'all' | 'active' | 'paused';

export function WebsitesView() {
  const zonesQuery = useZones();
  // The shell may have /api/zones cached before this page hydrates (command palette, zone
  // switcher). Show the loading state the server rendered until mounted.
  const mounted = useMounted();
  const data = mounted ? zonesQuery.data : undefined;
  const isLoading = !mounted || zonesQuery.isLoading;
  const error = mounted ? zonesQuery.error : null;
  const refetch = zonesQuery.refetch;
  const { canWrite } = useZonePermissions();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);

  // `/zones?create=1` (command palette, zone switcher) opens the dialog once the role is known, then drops the param.
  useQuickActionParam('create', () => setCreateOpen(true), canWrite);

  const zones = useMemo(() => data?.zones ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return zones.filter((z) => {
      if (status === 'active' && !z.enabled) return false;
      if (status === 'paused' && z.enabled) return false;
      if (!q) return true;
      return z.name.toLowerCase().includes(q) || z.originUrl.toLowerCase().includes(q) || zoneHostname(z).includes(q);
    });
  }, [zones, query, status]);
  const filtering = query.trim() !== '' || status !== 'all';

  const columns: DataTableColumn<Zone>[] = [
    {
      id: 'name',
      header: 'Website',
      className: 'min-w-56 max-w-80',
      cell: (z) => (
        <TablePrimaryLink
          className="max-w-[10.5rem] sm:max-w-xs"
          href={`/zones/${z.id}`}
          sub={
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono">{zoneHostname(z)}</span>
              <CopyButton
                value={zoneHostname(z)}
                label="Copy hostname"
                className="md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
              />
            </span>
          }
        >
          {z.name}
        </TablePrimaryLink>
      ),
    },
    {
      id: 'origin',
      header: 'Origin',
      hideBelow: 'md',
      className: 'max-w-64',
      cell: (z) => (
        <span className="block truncate text-muted-foreground" title={z.originUrl}>
          {z.originUrl}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (z) => <StatusDot tone={z.enabled ? 'success' : 'muted'}>{z.enabled ? 'Active' : 'Paused'}</StatusDot>,
    },
    {
      id: 'signed',
      header: 'Signed URLs',
      hideBelow: 'lg',
      cell: (z) =>
        z.signedUrlsRequired ? <Badge variant="default">Required</Badge> : <span className="text-muted-foreground">Off</span>,
    },
    {
      id: 'created',
      header: 'Created',
      hideBelow: 'sm',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (z) => <RelativeTime value={z.createdAt} />,
    },
  ];

  const addButton = canWrite ? (
    <Button leftIcon={<Plus />} onClick={() => setCreateOpen(true)}>
      Add a website
    </Button>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Websites"
        description="Each website pulls content from your origin and serves it from the edge cache."
        actions={!canWrite && data ? <ReadOnlyNote /> : undefined}
      />

      <DataTable
        aria-label="Websites"
        columns={columns}
        rows={filtered}
        getRowKey={(z) => z.id}
        loading={isLoading}
        skeletonRows={6}
        error={error ? 'Could not load your websites.' : null}
        onRetry={() => void refetch()}
        rowActions={(z) => <WebsiteRowActions zone={z} />}
        empty={
          <EmptyState
            icon={Globe}
            title="Add your first website"
            description="Point us at your origin server and we will cache and serve its content from the edge."
            action={addButton}
          />
        }
        emptyFiltered={
          filtering ? (
            <EmptyState
              title="No websites match your filters"
              description="Try a different name, origin, or status."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setStatus('all');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : undefined
        }
        toolbar={
          <TableToolbar
            search={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search websites"
            filters={
              <Select
                aria-label="Filter by status"
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                className="h-8 w-auto min-w-32 text-[13px]"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </Select>
            }
            count={data ? filtered.length : undefined}
            noun="website"
            actions={addButton}
          />
        }
      />

      {canWrite && <CreateZoneDialog open={createOpen} onOpenChange={setCreateOpen} trigger={null} />}
    </div>
  );
}

/** Kebab menu for one website row. Owns its own mutations and delete confirmation. */
function WebsiteRowActions({ zone }: { zone: Zone }) {
  const router = useRouter();
  const toast = useToast();
  const { canWrite, canDelete } = useZonePermissions();
  const update = useUpdateZone(zone.id);
  const remove = useDeleteZone(zone.id);
  const [deleting, setDeleting] = useState(false);
  const hostname = zoneHostname(zone);

  async function togglePaused() {
    const pausing = zone.enabled;
    try {
      await update.mutateAsync({ enabled: !pausing });
      toast.success(
        pausing ? 'Website paused' : 'Website resumed',
        pausing ? `${zone.name} is no longer served from the edge.` : `${zone.name} is serving traffic again.`,
      );
    } catch (err) {
      toast.error(
        pausing ? 'Could not pause the website' : 'Could not resume the website',
        errorMessage(err, 'Try again in a moment.'),
      );
    }
  }

  return (
    <>
      <ZoneRowMenu label={`Actions for ${zone.name}`}>
        {(openOverlay) => (
          <>
            <MenuItem icon={<ExternalLink />} onSelect={() => router.push(`/zones/${zone.id}`)}>
              Open
            </MenuItem>
            <MenuItem icon={<BarChart3 />} onSelect={() => router.push(`/zones/${zone.id}/analytics`)}>
              Analytics
            </MenuItem>
            <MenuItem icon={<Zap />} onSelect={() => router.push(`/zones/${zone.id}/caching`)}>
              Caching
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Copy />}
              onSelect={() =>
                void copyToClipboard(hostname, toast, {
                  success: 'Hostname copied',
                  description: hostname,
                })
              }
            >
              Copy hostname
            </MenuItem>
            {canWrite && (
              <MenuItem
                icon={zone.enabled ? <Pause /> : <Play />}
                disabled={update.isPending}
                onSelect={() => void togglePaused()}
              >
                {zone.enabled ? 'Pause website' : 'Resume website'}
              </MenuItem>
            )}
            {canDelete && (
              <>
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} tone="destructive" onSelect={() => openOverlay(() => setDeleting(true))}>
                  Delete website…
                </MenuItem>
              </>
            )}
          </>
        )}
      </ZoneRowMenu>
      {canDelete && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          tone="destructive"
          title="Delete website"
          description={
            <>
              This permanently removes <b className="font-semibold text-foreground">{zone.name}</b>, its cache rules, custom
              domains, and purge history. The edge stops serving it right away.
            </>
          }
          confirmLabel="Delete website"
          requireText={zone.name}
          successToast={{
            title: 'Website deleted',
            description: `${zone.name} was removed.`,
          }}
          errorFallback="Could not delete the website."
          onConfirm={() => remove.mutateAsync()}
        />
      )}
    </>
  );
}
