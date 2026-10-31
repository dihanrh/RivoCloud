import { ChartSkeleton } from '@/components/analytics/chart-states';
import { Skeleton } from '@/components/ui/skeleton';

function Panel({ className, chart = 'h-64' }: { className?: string; chart?: string }) {
  return (
    <div className={`rounded-[var(--radius)] border border-border bg-background px-5 pb-5 pt-4 ${className ?? ''}`}>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-1.5 h-3 w-40" />
      <ChartSkeleton className={`mt-4 ${chart}`} />
    </div>
  );
}

export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-4">
      <div className="mb-2 flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>
      <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-background p-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-background p-4">
            <Skeleton className="h-3.5 w-24" />
            <div className="flex items-end justify-between gap-3">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" />
        <Panel chart="h-48" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
