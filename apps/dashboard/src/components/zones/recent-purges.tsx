'use client';

import { History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { RelativeTime } from '@/components/ui/relative-time';
import { useInvalidations } from '@/hooks/use-cache-purge';
import { formatNumber } from '@/lib/format';
import type { CacheInvalidation } from '@/lib/types';

const STATUS: Record<string, { label: string; variant: 'warning' | 'success' | 'destructive' }> = {
  pending: { label: 'In progress', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
};

function describeTarget(inv: CacheInvalidation): React.ReactNode {
  if (inv.tags.length === 0 && inv.patterns.length === 1 && inv.patterns[0] === '*') {
    return <span className="font-medium">Everything</span>;
  }
  const entries = [
    ...inv.patterns.map((p) => ({ key: `p:${p}`, text: p })),
    ...inv.tags.map((t) => ({ key: `t:${t}`, text: `tag: ${t}` })),
  ];
  const shown = entries.slice(0, 3);
  return (
    <span className="flex flex-col gap-0.5">
      {shown.map((e) => (
        <span key={e.key} className="break-all font-mono text-xs">
          {e.text}
        </span>
      ))}
      {entries.length > shown.length && (
        <span className="text-xs text-muted-foreground">and {entries.length - shown.length} more</span>
      )}
    </span>
  );
}

const columns: DataTableColumn<CacheInvalidation>[] = [
  { id: 'target', header: 'Purged', className: 'min-w-48', cell: describeTarget },
  {
    id: 'status',
    header: 'Status',
    cell: (inv) => {
      const status = STATUS[inv.status] ?? { label: inv.status, variant: 'warning' as const };
      return <Badge variant={status.variant}>{status.label}</Badge>;
    },
  },
  {
    id: 'keys',
    header: 'Keys purged',
    align: 'right',
    hideBelow: 'md',
    className: 'tabular-nums',
    cell: (inv) => formatNumber(inv.keysPurged),
  },
  {
    id: 'edges',
    header: 'Edges notified',
    align: 'right',
    hideBelow: 'md',
    className: 'tabular-nums',
    cell: (inv) => formatNumber(inv.edgesNotified),
  },
  {
    id: 'requested',
    header: 'Requested',
    align: 'right',
    className: 'whitespace-nowrap text-muted-foreground',
    cell: (inv) => <RelativeTime value={inv.createdAt} />,
  },
];

export function RecentPurges({ zoneId }: { zoneId: string }) {
  const { data, isLoading, error, refetch } = useInvalidations(zoneId);

  return (
    <DataTable
      aria-label="Recent purges"
      columns={columns}
      rows={data?.invalidations}
      getRowKey={(inv) => inv.id}
      loading={isLoading}
      skeletonRows={3}
      error={error ? 'Could not load recent purges.' : null}
      onRetry={() => void refetch()}
      empty={<EmptyState className="py-8" icon={History} title="No purges yet" description="Purges you run on this website appear here." />}
    />
  );
}
