import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading page">
      <div className="mb-6 flex flex-col gap-3">
        <Skeleton className="h-3.5 w-36" />
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="hidden h-9 w-32 sm:block" />
        </div>
      </div>
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-background">
        <div className="flex gap-2 p-3">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="hidden h-8 w-32 sm:block" />
        </div>
        <div className="border-t border-border">
          <TableSkeleton rows={6} columns={5} />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
