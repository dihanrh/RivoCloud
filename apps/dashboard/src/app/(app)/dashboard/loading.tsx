import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';

function Tile() {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-background p-4">
      <Skeleton className="h-3.5 w-24" />
      <div className="flex items-end justify-between gap-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  );
}

function SidePanel() {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-background p-4">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-9 w-36 sm:block" />
      </div>
      <div>
        <Skeleton className="mb-3 h-4 w-40" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Tile />
          <Tile />
          <Tile />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="self-start overflow-hidden rounded-[var(--radius)] border border-border bg-background">
          <div className="flex justify-between px-4 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="border-t border-border">
            <TableSkeleton rows={4} columns={3} />
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <SidePanel />
          <SidePanel />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
