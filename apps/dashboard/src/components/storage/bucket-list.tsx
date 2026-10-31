'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Boxes, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, RowActionsMenu, TablePrimaryLink, TableToolbar, type DataTableColumn } from '@/components/ui/data-table';
import { MenuItem, MenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/input';
import { RelativeTime } from '@/components/ui/relative-time';
import { useToast } from '@/components/ui/toast';
import type { Bucket } from '@/lib/types';
import { afterMenuClose } from '@/lib/after-menu-close';

type Visibility = 'all' | 'private' | 'public';

export interface BucketListProps {
  buckets: Bucket[] | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Shown as the toolbar's primary action and in the empty state. Omit for read-only roles. */
  onCreate?: () => void;
  /** Adds "Delete bucket" to each row's menu. Omit for roles that can't delete. */
  onDelete?: (bucket: Bucket) => void;
}

export function BucketList({ buckets, loading, error, onRetry, onCreate, onDelete }: BucketListProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (buckets ?? []).filter(
      (b) =>
        (visibility === 'all' || (visibility === 'public') === b.public) &&
        (!q || b.name.toLowerCase().includes(q) || b.region.toLowerCase().includes(q)),
    );
  }, [buckets, search, visibility]);
  const filtering = search.trim() !== '' || visibility !== 'all';

  async function copyName(name: string) {
    try {
      await navigator.clipboard.writeText(name);
      toast.success('Bucket name copied', name);
    } catch {
      toast.error('Could not copy', 'Select the name and copy it manually.');
    }
  }

  const columns: DataTableColumn<Bucket>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (b) => (
        <TablePrimaryLink href={`/storage/${b.id}`} sub={b.region}>
          {b.name}
        </TablePrimaryLink>
      ),
    },
    {
      id: 'visibility',
      header: 'Visibility',
      cell: (b) => <Badge variant={b.public ? 'warning' : 'secondary'}>{b.public ? 'Public' : 'Private'}</Badge>,
    },
    {
      id: 'versioning',
      header: 'Versioning',
      cell: (b) => <span className="text-muted-foreground">{b.versioningEnabled ? 'On' : 'Off'}</span>,
      hideBelow: 'md',
    },
    {
      id: 'created',
      header: 'Created',
      cell: (b) => <RelativeTime value={b.createdAt} className="text-muted-foreground" />,
      align: 'right',
      hideBelow: 'sm',
    },
  ];

  const createButton = onCreate ? (
    <Button leftIcon={<Plus />} onClick={onCreate}>
      Create bucket
    </Button>
  ) : undefined;

  return (
    <DataTable
      aria-label="Buckets"
      columns={columns}
      rows={filtered}
      getRowKey={(b) => b.id}
      loading={loading}
      error={error ? 'Could not load your buckets.' : null}
      onRetry={onRetry}
      toolbar={
        <TableToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search buckets"
          count={buckets ? filtered.length : undefined}
          noun="bucket"
          filters={
            <Select
              aria-label="Visibility"
              className="h-8 w-auto min-w-32 text-[13px]"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
            >
              <option value="all">All visibility</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </Select>
          }
          actions={createButton}
        />
      }
      empty={
        <EmptyState
          icon={Boxes}
          title="No buckets yet"
          description="Create a bucket to start uploading files and sharing them with signed links."
          action={createButton}
        />
      }
      emptyFiltered={
        filtering ? (
          <EmptyState
            title="No matching buckets"
            description="Try a different name, or clear the filters."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setVisibility('all');
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : undefined
      }
      rowActions={(b) => (
        <RowActionsMenu label={`Actions for ${b.name}`}>
          <MenuItem asChild>
            <Link href={`/storage/${b.id}`}>
              <ExternalLink className="text-muted-foreground" aria-hidden />
              Open
            </Link>
          </MenuItem>
          <MenuItem icon={<Copy />} onSelect={() => void copyName(b.name)}>
            Copy name
          </MenuItem>
          {onDelete && (
            <>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} tone="destructive" onSelect={() => afterMenuClose(() => onDelete(b))}>
                Delete bucket…
              </MenuItem>
            </>
          )}
        </RowActionsMenu>
      )}
    />
  );
}
