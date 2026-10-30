import * as React from 'react';
import { cn } from '@/lib/utils';

const fieldClass =
  'w-full rounded-[var(--radius)] border border-border-strong bg-background px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} className={cn(fieldClass, 'h-9 py-1', className)} ref={ref} {...props} />
  ),
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select className={cn(fieldClass, 'h-9 py-1 pr-8', className)} ref={ref} {...props} />
  ),
);
Select.displayName = 'Select';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea className={cn(fieldClass, 'min-h-24 py-2 font-mono text-[13px]', className)} ref={ref} {...props} />
  ),
);
Textarea.displayName = 'Textarea';
