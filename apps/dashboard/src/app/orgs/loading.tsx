import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-dvh flex-col bg-canvas">
      <div className="h-14 border-b border-border bg-background" />
      <div className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center sm:py-16">
        <div className="w-full max-w-md rounded-[var(--radius)] border border-border bg-background p-6 sm:p-8">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
          <div className="mt-6 flex flex-col gap-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
