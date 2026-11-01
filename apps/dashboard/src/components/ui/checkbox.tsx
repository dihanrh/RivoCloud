'use client';

/**
 * Checkbox — a styled native checkbox (keeps native form/keyboard behaviour).
 *
 *   import { Checkbox } from '@/components/ui/checkbox';
 *   <Checkbox checked={all} indeterminate={some} onCheckedChange={setAll} aria-label="Select all" />
 *   <Checkbox label="Public bucket" description="Anyone with the link can read files." … />
 *
 * Props: every <input> prop, plus onCheckedChange(next: boolean), indeterminate,
 *   label / description (renders a clickable label next to the box).
 */
import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onCheckedChange?: (next: boolean) => void;
  indeterminate?: boolean;
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, onCheckedChange, onChange, indeterminate = false, label, description, id, disabled, ...props },
  forwardedRef,
) {
  const innerRef = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);
  React.useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const autoId = React.useId();
  const inputId = id ?? autoId;

  const box = (
    <span className={cn('relative inline-flex h-4 w-4 shrink-0', className)}>
      <input
        ref={innerRef}
        id={inputId}
        type="checkbox"
        disabled={disabled}
        aria-checked={indeterminate ? 'mixed' : undefined}
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.target.checked);
        }}
        className="peer h-4 w-4 cursor-pointer appearance-none rounded-[4px] border border-border-strong bg-background transition-colors checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto hidden h-3 w-3 text-primary-foreground peer-checked:block peer-indeterminate:hidden"
      />
      <Minus
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto hidden h-3 w-3 text-primary-foreground peer-indeterminate:block"
      />
    </span>
  );

  if (!label) return box;
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex">{box}</span>
      <label htmlFor={inputId} className={cn('cursor-pointer select-none text-[13px]', disabled && 'cursor-not-allowed opacity-60')}>
        <span className="font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-muted-foreground">{description}</span>}
      </label>
    </div>
  );
});
