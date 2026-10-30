import { cn } from '@/lib/utils';

/** A product-UI frame used by every mockup: a hairline window with a title bar. */
export function MockWindow({
  title,
  meta,
  children,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-background text-left shadow-[0_24px_48px_-28px_rgba(29,32,37,0.35)]',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-border bg-muted px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#e2e4e8]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#e2e4e8]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#e2e4e8]" />
        </div>
        <p className="min-w-0 truncate text-[12px] font-medium text-foreground">{title}</p>
        {meta && <div className="ml-auto shrink-0 text-[11px] text-muted-foreground">{meta}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' | 'info';
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground border border-border',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-destructive-soft text-destructive',
    brand: 'bg-primary-soft text-primary',
    info: 'bg-[#efe8f7] text-brand-purple',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', tones, className)}>
      {children}
    </span>
  );
}
