'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Input classes shared by every auth field: a roomier 40px control with an error state. */
export const authInputClass =
  'h-10 px-3 text-[14px] aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/25';

export function errorId(id: string) {
  return `${id}-error`;
}

export interface FieldAria {
  'aria-invalid': boolean;
  'aria-describedby'?: string;
}

/**
 * Label + control + inline error. The control is a render prop so it receives
 * the aria-invalid / aria-describedby wiring for its error message.
 */
export function FormField({
  id,
  label,
  error,
  labelAside,
  describedBy,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  labelAside?: React.ReactNode;
  /** Extra ids (a hint, a strength meter) the control should be described by. */
  describedBy?: string;
  children: (aria: FieldAria) => React.ReactNode;
  className?: string;
}) {
  const ids = [error ? errorId(id) : undefined, describedBy].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-[13px]">
          {label}
        </Label>
        {labelAside}
      </div>
      {children({ 'aria-invalid': Boolean(error), 'aria-describedby': ids || undefined })}
      <FieldError id={errorId(id)} message={error} />
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-destructive">
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/** Top-of-form banner for server errors (role="alert") or confirmations (role="status"). */
export function FormBanner({ tone = 'error', children }: { tone?: 'error' | 'success'; children: React.ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-snug',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive-soft text-destructive'
          : 'border-success/30 bg-success-soft text-success',
      )}
    >
      <Icon className="mt-px h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
