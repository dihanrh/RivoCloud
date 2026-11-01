/**
 * Skeletons — loading placeholders shaped like the content they stand in for.
 *
 *   import { Skeleton, TableSkeleton, PageSkeleton } from '@/components/ui/skeleton';
 *   <Skeleton className="h-4 w-40" />
 *   <TableSkeleton rows={5} columns={4} />          // a whole table (header + rows), inside a Card
 *   <TableSkeleton rows={5} columns={4} bare />     // only <tr>s, for use inside an existing <tbody>
 *   <PageSkeleton />                                // header + stat tiles + table (used by loading.tsx)
 */
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-[#e9ebee]', className)} {...props} />;
}

// Varying widths so a skeleton table doesn't look like a barcode.
const WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3', 'w-2/3', 'w-1/4'];

export function TableSkeleton({
  rows = 5,
  columns = 4,
  bare = false,
  className,
  cellClassNames,
}: {
  rows?: number;
  columns?: number;
  /** Render only the <tr> rows (to drop into an existing <tbody>). */
  bare?: boolean;
  className?: string;
  /** Per-column classes for the cells (e.g. `hidden sm:table-cell`), so the skeleton hides the same columns as the real table. */
  cellClassNames?: (string | undefined)[];
}) {
  const body = Array.from({ length: rows }, (_, r) => (
    <tr key={r} className="border-b border-border last:border-0">
      {Array.from({ length: columns }, (_, c) => (
        <td key={c} className={cn('px-4 py-3', cellClassNames?.[c])}>
          <Skeleton className={cn('h-3.5', c === 0 ? 'w-3/4' : WIDTHS[(r + c) % WIDTHS.length])} />
        </td>
      ))}
    </tr>
  ));
  if (bare) return <>{body}</>;
  return (
    <div role="status" aria-label="Loading" className={cn('w-full overflow-hidden', className)}>
      <table className="w-full">
        <thead className="border-b border-border bg-muted">
          <tr>
            {Array.from({ length: columns }, (_, c) => (
              <th key={c} className={cn('h-9 px-4 text-left', cellClassNames?.[c])}>
                <Skeleton className="h-3 w-16 bg-[#e1e4e8]" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}

/** Generic page placeholder: header, a row of tiles, and a table panel. */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading page" className={cn('flex flex-col gap-6', className)}>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-32" />
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
          <Skeleton className="hidden h-9 w-32 sm:block" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-[var(--radius)] border border-border bg-background p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="rounded-[var(--radius)] border border-border bg-background">
        <div className="flex items-center gap-3 border-b border-border p-3">
          <Skeleton className="h-8 w-64 max-w-full" />
        </div>
        <TableSkeleton rows={6} columns={4} />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
