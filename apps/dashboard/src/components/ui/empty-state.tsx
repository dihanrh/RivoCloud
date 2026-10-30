import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** An empty panel that tells the user what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {Icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      )}
      <div>
        <p className="text-base font-semibold">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Inline error banner for a failed load or action. */
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-[var(--radius)] border border-destructive/40 bg-destructive-soft px-4 py-3 text-[13px] text-destructive">
      {children}
    </div>
  );
}
