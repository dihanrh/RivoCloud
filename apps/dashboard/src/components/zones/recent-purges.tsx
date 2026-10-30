'use client';

import { History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useInvalidations } from '@/hooks/use-cache-purge';
import type { CacheInvalidation } from '@/lib/types';
import { formatDateTime } from './format';

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

export function RecentPurges({ zoneId }: { zoneId: string }) {
  const { data, isLoading, error } = useInvalidations(zoneId);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error) return <ErrorBanner>Could not load recent purges. Refresh the page to try again.</ErrorBanner>;

  const invalidations = data?.invalidations ?? [];
  return (
    <Card>
      {invalidations.length === 0 ? (
        <EmptyState icon={History} title="No purges yet" description="Purges you run on this website appear here." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Purged</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Keys purged</TableHead>
              <TableHead className="text-right">Edges notified</TableHead>
              <TableHead>Requested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invalidations.map((inv) => {
              const status = STATUS[inv.status] ?? { label: inv.status, variant: 'warning' as const };
              return (
                <TableRow key={inv.id}>
                  <TableCell className="min-w-48">{describeTarget(inv)}</TableCell>
                  <TableCell>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{inv.keysPurged ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{inv.edgesNotified ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(inv.createdAt)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
