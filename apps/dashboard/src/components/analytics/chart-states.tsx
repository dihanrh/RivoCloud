import { BarChart3 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Placeholder with the chart's exact height so nothing jumps when data arrives. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading chart" className={cn('flex w-full flex-col justify-end gap-2', className)}>
      <div className="flex flex-1 items-end gap-1.5">
        {[40, 62, 48, 70, 55, 82, 64, 90, 72, 58, 76, 66].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
        ))}
      </div>
      <Skeleton className="h-3 w-full" />
    </div>
  );
}

/** "Nothing in this range" placeholder, same height as the chart it replaces. */
export function ChartEmpty({ className, children = 'No traffic in this range.' }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn('flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-center', className)}>
      <BarChart3 className="h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="text-[13px] text-muted-foreground">{children}</p>
    </div>
  );
}

/** Inline error for a chart that failed to load. */
export function ChartError({ className }: { className?: string }) {
  return (
    <div role="alert" className={cn('flex w-full items-center justify-center rounded-md bg-destructive-soft text-[13px] text-destructive', className)}>
      Could not load this chart.
    </div>
  );
}
