import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Sparkline } from './sparkline';

/**
 * A headline number with an optional trend sparkline.
 *   <KpiTile label="Requests" value="12.3K" hint="Last 24 hours" trend={[…]} loading={q.isLoading} />
 */
export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  loading,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  trend?: number[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col gap-3 p-4 transition-shadow duration-150 hover:shadow-[0_4px_16px_-8px_rgba(29,32,37,0.18)]', className)}>
      <div className="flex items-center gap-2">
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary" aria-hidden>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <p className="truncate text-[26px] font-semibold leading-tight tracking-tight">{value}</p>
          )}
          {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {trend !== undefined &&
          (loading ? <Skeleton className="h-10 w-28 shrink-0" /> : <Sparkline values={trend} className="h-10 w-28 shrink-0" />)}
      </div>
    </Card>
  );
}
