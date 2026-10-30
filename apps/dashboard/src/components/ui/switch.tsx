'use client';

/**
 * Switch — an accessible on/off toggle (role="switch").
 *
 *   import { Switch } from '@/components/ui/switch';
 *   <Switch checked={zone.enabled} onCheckedChange={(v) => update.mutate({ enabled: v })}
 *           label="Serve traffic" loading={update.isPending} />
 *
 * Props: checked, onCheckedChange(next), label (accessible name when no visible <label htmlFor>),
 *   disabled, loading (spinner in the thumb, disabled), size ('default' 44x24 | 'sm' 36x20), id,
 *   plus any button attributes (aria-describedby…).
 * `onChange(next)` is accepted as a legacy alias (the old zones/Toggle API).
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean;
  onCheckedChange?: (next: boolean) => void;
  /** @deprecated use onCheckedChange */
  onChange?: (next: boolean) => void;
  label?: string;
  loading?: boolean;
  size?: 'default' | 'sm';
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, onChange, label, loading = false, disabled, size = 'default', className, onClick, ...props },
  ref,
) {
  const sm = size === 'sm';
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onCheckedChange?.(!checked);
        onChange?.(!checked);
      }}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 aria-busy:opacity-80',
        sm ? 'h-5 w-9' : 'h-6 w-11',
        checked ? 'bg-primary' : 'bg-border-strong',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'flex items-center justify-center rounded-full bg-background shadow-[0_1px_2px_rgba(29,32,37,0.25)] transition-transform duration-150 ease-out',
          sm ? 'h-4 w-4' : 'h-5 w-5',
          checked ? (sm ? 'translate-x-[18px]' : 'translate-x-[22px]') : 'translate-x-0.5',
        )}
      >
        {loading && <Loader2 className={cn('animate-spin text-muted-foreground', sm ? 'h-2.5 w-2.5' : 'h-3 w-3')} />}
      </span>
    </button>
  );
});
