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
    <Card className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <p className="truncate text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          )}
          {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {trend !== undefined &&
          (loading ? <Skeleton className="h-8 w-24 shrink-0" /> : <Sparkline values={trend} className="h-8 w-24 shrink-0" />)}
      </div>
    </Card>
  );
}
