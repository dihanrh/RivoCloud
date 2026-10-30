/**
 * Button — the only clickable action primitive.
 *
 *   import { Button } from '@/components/ui/button';
 *   <Button>Save</Button>
 *   <Button variant="secondary" leftIcon={<Plus />}>Add rule</Button>
 *   <Button loading={mutation.isPending}>Create bucket</Button>
 *   <Button variant="ghost" size="icon-sm" aria-label="More actions"><MoreHorizontal /></Button>
 *
 * variant: default (primary pink) | secondary (neutral outline) | outline | ghost |
 *          destructive | destructive-outline | link
 * size:    sm | default | lg | icon (32px) | icon-sm (28px)
 * loading: shows a spinner over the label (width is kept), sets aria-busy and disables.
 * leftIcon / rightIcon: icons placed around the label (hidden by the spinner while loading).
 * asChild: render the child (e.g. a Next <Link>) with button styling. `loading` is ignored with asChild.
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50 aria-busy:opacity-80 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[0_1px_0_rgba(29,32,37,0.08)] hover:bg-primary-hover',
        secondary:
          'border border-border bg-background text-foreground shadow-[0_1px_0_rgba(29,32,37,0.04)] hover:border-border-strong hover:bg-muted',
        outline: 'border border-border-strong bg-background text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover',
        'destructive-outline': 'border border-destructive bg-background text-destructive hover:bg-destructive-soft',
        ghost: 'text-foreground hover:bg-muted',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-[13px]',
        lg: 'h-10 px-5',
        icon: 'h-8 w-8 p-0',
        'icon-sm': 'h-7 w-7 p-0 [&_svg]:size-[15px]',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Show a spinner, keep the width, set aria-busy and disable the button. */
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, leftIcon, rightIcon, disabled, children, ...props },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size }), className);
    if (asChild) {
      return <Slot className={classes} ref={ref} {...props}>{children}</Slot>;
    }
    const hasDecor = loading || leftIcon || rightIcon;
    return (
      <button
        className={classes}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        {hasDecor ? (
          <>
            {/* The content stays in the layout (transparent, still named) while loading so the width never jumps. */}
            <span className={cn('inline-flex items-center justify-center gap-1.5', loading && 'opacity-0')}>
              {leftIcon}
              {children}
              {rightIcon}
            </span>
            {loading && (
              <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                <Loader2 className="animate-spin" />
              </span>
            )}
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
