/**
 * Text inputs: Input, Select, Textarea. Wrap them in <Field> for label/hint/error wiring.
 *
 *   import { Input, Select, Textarea } from '@/components/ui/input';
 *   <Input placeholder="example.com" />
 *   <Input leftIcon={<Search />} placeholder="Search websites" />
 *   <Input leftAddon="https://" rightAddon=".rivo.app" />
 *   <Input invalid />                 // or aria-invalid; Field sets it for you
 *
 * Input props: every <input> prop, plus
 *   leftIcon   – icon inside the field on the left (muted, 16px)
 *   leftAddon / rightAddon – attached grey segment (text, a unit, a button)
 *   invalid    – red border (same as aria-invalid="true")
 *   inputClassName – classes for the <input> when an icon/addon wraps it
 *                    (className then styles the wrapper, so width utilities still work).
 * Select / Textarea: every native prop plus `invalid`. Textarea is monospace (config/JSON).
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export const fieldClass =
  'w-full rounded-[var(--radius)] border border-border-strong bg-background px-3 text-sm text-foreground transition-[color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground hover:border-[#9aa1ab] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/25';

function isInvalid(invalid: boolean | undefined, aria: React.AriaAttributes['aria-invalid']): true | undefined {
  return invalid || aria === true || aria === 'true' ? true : undefined;
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
  invalid?: boolean;
  inputClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, inputClassName, type, leftIcon, leftAddon, rightAddon, invalid, ...props }, ref) => {
    const ariaInvalid = isInvalid(invalid, props['aria-invalid']);
    if (!leftIcon && !leftAddon && !rightAddon) {
      return <input type={type} className={cn(fieldClass, 'h-9 py-1', className)} ref={ref} {...props} aria-invalid={ariaInvalid} />;
    }
    const addon = 'flex shrink-0 items-center border-border-strong bg-muted px-3 text-[13px] text-muted-foreground';
    return (
      <div className={cn('relative flex w-full items-stretch', className)}>
        {leftAddon && <span className={cn(addon, 'rounded-l-[var(--radius)] border border-r-0')}>{leftAddon}</span>}
        <div className="relative min-w-0 flex-1">
          {leftIcon && (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-muted-foreground [&_svg]:size-4" aria-hidden>
              {leftIcon}
            </span>
          )}
          <input
            type={type}
            ref={ref}
            className={cn(
              fieldClass,
              'h-9 py-1',
              leftIcon && 'pl-9',
              leftAddon && 'rounded-l-none',
              rightAddon && 'rounded-r-none',
              inputClassName,
            )}
            {...props}
            aria-invalid={ariaInvalid}
          />
        </div>
        {rightAddon && <span className={cn(addon, 'rounded-r-[var(--radius)] border border-l-0')}>{rightAddon}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235e6670' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, invalid, style, ...props }, ref) => (
  <select
    className={cn(fieldClass, 'h-9 cursor-pointer appearance-none bg-no-repeat py-1 pr-8', className)}
    style={{ backgroundImage: SELECT_CHEVRON, backgroundPosition: 'right 0.6rem center', backgroundSize: '16px', ...style }}
    ref={ref}
    {...props}
    aria-invalid={isInvalid(invalid, props['aria-invalid'])}
  />
));
Select.displayName = 'Select';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, invalid, ...props }, ref) => (
  <textarea
    className={cn(fieldClass, 'min-h-24 py-2 font-mono text-[13px]', className)}
    ref={ref}
    {...props}
    aria-invalid={isInvalid(invalid, props['aria-invalid'])}
  />
));
Textarea.displayName = 'Textarea';
