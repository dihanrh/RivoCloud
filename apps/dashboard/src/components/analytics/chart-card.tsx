import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** The one card style for charts and analytics tables: title + optional description/action. */
export function ChartCard({
  title,
  description,
  action,
  flush,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Let a table run edge to edge under the header. */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className={cn('flex-1', flush ? 'border-t border-border' : 'px-5 pb-5')}>{children}</div>
    </Card>
  );
}
