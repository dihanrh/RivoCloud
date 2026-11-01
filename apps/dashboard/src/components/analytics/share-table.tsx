import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface ShareRow {
  key: string;
  label: React.ReactNode;
  requests: number;
  bytesSent?: number;
}

/** A ranked table with a share-of-requests bar per row (countries, top paths). */
export function ShareTable({
  rows,
  labelHeader,
  loading,
  error,
  emptyText = 'No data for this range.',
  showBytes = true,
}: {
  rows: ShareRow[];
  labelHeader: string;
  loading?: boolean;
  error?: boolean;
  emptyText?: string;
  showBytes?: boolean;
}) {
  const total = rows.reduce((sum, r) => sum + r.requests, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.requests), 0);
  const cols = showBytes ? 4 : 3;

  return (
    <Table aria-busy={loading || undefined}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[42%]">{labelHeader}</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          {showBytes && <TableHead className="hidden text-right sm:table-cell">Bandwidth</TableHead>}
          <TableHead className="w-[26%]">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading &&
          Array.from({ length: 5 }, (_, i) => (
            <TableRow key={i}>
              {Array.from({ length: cols }, (_, c) => (
                <TableCell key={c} className={cn(c === 2 && showBytes && 'hidden sm:table-cell')}>
                  <Skeleton className={cn('h-3.5', c === 0 ? 'w-3/4' : 'ml-auto w-12', c === cols - 1 && 'ml-0 w-full')} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        {!loading &&
          rows.map((row, index) => {
            const share = total ? row.requests / total : 0;
            return (
              <TableRow key={row.key}>
                <TableCell className="max-w-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <div className="min-w-0 flex-1 truncate">{row.label}</div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.requests)}</TableCell>
                {showBytes && (
                  <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{formatBytes(row.bytesSent ?? 0)}</TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f1f2f5]" aria-hidden>
                      <div className="h-full rounded-full bg-primary/85" style={{ width: `${max ? (row.requests / max) * 100 : 0}%` }} />
                    </div>
                    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(share)}</span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        {!loading && (error || rows.length === 0) && (
          <TableRow>
            <TableCell colSpan={cols} className={cn('py-8 text-center', error ? 'text-destructive' : 'text-muted-foreground')}>
              {error ? 'Could not load this table.' : emptyText}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
