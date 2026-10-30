'use client';

/**
 * Field — label + control + hint + error, with the ARIA wiring done for you.
 *
 *   import { Field } from '@/components/ui/field';
 *   <Field label="Bucket name" hint="Lowercase letters, numbers and dashes." error={errors.name} required>
 *     <Input value={name} onChange={…} />
 *   </Field>
 *
 * The single child control receives: id (generated unless it has one), aria-describedby
 * (hint + error ids, merged with its own), aria-invalid when `error` is set, and `required`.
 * Props: label, hint (hidden while an error shows), error, required (sets `required` on the
 *   control; no asterisk is drawn), optional (adds a muted "(optional)" after the label),
 *   labelAction (node right-aligned on the label row, e.g. a "Generate" link), className, children.
 */
import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from './label';

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  labelAction?: React.ReactNode;
  className?: string;
  children: React.ReactElement<Record<string, unknown>>;
}

export function Field({ label, hint, error, required, optional, labelAction, className, children }: FieldProps) {
  const autoId = React.useId();
  const childProps = children.props as { id?: string; 'aria-describedby'?: string };
  const id = childProps.id ?? `${autoId}-control`;
  const hintId = hint && !error ? `${autoId}-hint` : undefined;
  const errorId = error ? `${autoId}-error` : undefined;
  const describedBy = [childProps['aria-describedby'], errorId, hintId].filter(Boolean).join(' ') || undefined;

  const control = React.cloneElement(children, {
    id,
    'aria-describedby': describedBy,
    ...(error ? { 'aria-invalid': true } : {}),
    ...(required ? { required: true } : {}),
  });

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || labelAction) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <Label htmlFor={id} className="text-[13px] font-medium">
              {label}
              {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
            </Label>
          )}
          {labelAction}
        </div>
      )}
      {control}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
