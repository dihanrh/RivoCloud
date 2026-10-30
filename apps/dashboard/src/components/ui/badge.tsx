import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-primary-soft text-primary',
        secondary: 'bg-muted text-muted-foreground border border-border',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        destructive: 'bg-destructive-soft text-destructive',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** A coloured dot + label, for live/paused style status in tables. */
export function StatusDot({ tone, children }: { tone: 'success' | 'warning' | 'destructive' | 'muted'; children: React.ReactNode }) {
  const color = {
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    muted: 'bg-border-strong',
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span className={cn('h-2 w-2 rounded-full', color)} aria-hidden />
      {children}
    </span>
  );
}
