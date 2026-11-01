'use client';

import { useMemo, useState } from 'react';
import { Copy, FileText, Link2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DataTable, RowActionsMenu, TableToolbar, type DataTableColumn } from '@/components/ui/data-table';
import { MenuItem, MenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/input';
import { RelativeTime } from '@/components/ui/relative-time';
import { useToast } from '@/components/ui/toast';
import { formatBytes } from '@/lib/format';
import type { StorageObject } from '@/lib/types';

// A pending object has been issued an upload URL but storage hasn't confirmed the file landed yet.
const STATUS_BADGE: Record<StorageObject['status'], { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  ready: { label: 'Ready', variant: 'success' },
  pending: { label: 'Uploading', variant: 'warning' },
  deleted: { label: 'Deleted', variant: 'destructive' },
};

type StatusFilter = 'all' | StorageObject['status'];

export interface ObjectBrowserProps {
  objects: StorageObject[] | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Adds "Delete file" to each row's menu. Omit for roles that can't delete. */
  onDelete?: (key: string) => void;
  /** Adds "Share link" for ready files. */
  onShare?: (key: string) => void;
  emptyAction?: React.ReactNode;
}

export function ObjectBrowser({ objects, loading, error, onRetry, onDelete, onShare, emptyAction }: ObjectBrowserProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (objects ?? []).filter(
      (o) => (status === 'all' || o.status === status) && (!q || o.key.toLowerCase().includes(q) || o.contentType.toLowerCase().includes(q)),
    );
  }, [objects, search, status]);
  const filtering = search.trim() !== '' || status !== 'all';

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      toast.success('Key copied', key);
    } catch {
      toast.error('Could not copy', 'Select the key and copy it manually.');
    }
  }

  const columns: DataTableColumn<StorageObject>[] = [
    {
      id: 'key',
      header: 'Key',
      cell: (o) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground sm:flex" aria-hidden>
            <FileText className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="break-all font-medium">{o.key}</span>
            <span className="truncate text-xs text-muted-foreground md:hidden">{o.contentType}</span>
          </div>
        </div>
      ),
    },
    { id: 'size', header: 'Size', cell: (o) => formatBytes(o.size), className: 'whitespace-nowrap tabular-nums', align: 'right' },
    { id: 'type', header: 'Type', cell: (o) => <span className="text-muted-foreground">{o.contentType}</span>, hideBelow: 'md' },
    {
      id: 'status',
      header: 'Status',
      cell: (o) => <Badge variant={STATUS_BADGE[o.status].variant}>{STATUS_BADGE[o.status].label}</Badge>,
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      cell: (o) => <RelativeTime value={o.createdAt} className="whitespace-nowrap text-muted-foreground" />,
      align: 'right',
      hideBelow: 'sm',
    },
  ];

  return (
    <DataTable
      aria-label="Files"
      columns={columns}
      rows={filtered}
      getRowKey={(o) => o.id}
      loading={loading}
      error={error ? 'Could not load the files in this bucket.' : null}
      onRetry={onRetry}
      toolbar={
        <TableToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search files"
          count={objects ? filtered.length : undefined}
          noun="file"
          filters={
            <Select
              aria-label="Status"
              className="h-8 w-auto min-w-32 text-[13px]"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="ready">Ready</option>
              <option value="pending">Uploading</option>
            </Select>
          }
        />
      }
      empty={<EmptyState icon={FileText} title="No files yet" description="Upload a file to store it in this bucket." action={emptyAction} />}
      emptyFiltered={
        filtering ? <EmptyState title="No matching files" description="Try a different key, or clear the filters." /> : undefined
      }
      rowActions={(o) => (
        <RowActionsMenu label={`Actions for ${o.key}`}>
          {onShare && o.status === 'ready' && (
            <MenuItem icon={<Link2 />} onSelectAfterClose={() => onShare(o.key)}>
              Share link…
            </MenuItem>
          )}
          <MenuItem icon={<Copy />} onSelect={() => void copyKey(o.key)}>
            Copy key
          </MenuItem>
          {onDelete && (
            <>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} tone="destructive" onSelectAfterClose={() => onDelete(o.key)}>
                Delete file…
              </MenuItem>
            </>
          )}
        </RowActionsMenu>
      )}
    />
  );
}
