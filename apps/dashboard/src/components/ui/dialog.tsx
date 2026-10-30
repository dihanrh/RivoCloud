'use client';

/**
 * Dialog (Radix) — modal for create/edit forms with up to ~6 fields.
 *
 *   import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
 *            DialogBody, DialogFooter, DialogForm, DialogClose } from '@/components/ui/dialog';
 *
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent size="md" preventClose={mutation.isPending}>
 *       <DialogForm onSubmit={submit}>
 *         <DialogHeader>
 *           <DialogTitle>Create bucket</DialogTitle>
 *           <DialogDescription>Buckets hold your files.</DialogDescription>
 *         </DialogHeader>
 *         <DialogBody>…fields…</DialogBody>
 *         <DialogFooter>
 *           <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
 *           <Button type="submit" loading={mutation.isPending}>Create bucket</Button>
 *         </DialogFooter>
 *       </DialogForm>
 *     </DialogContent>
 *   </Dialog>
 *
 * - size: sm (384px) | md (512px, default) | lg (672px) | xl (896px).
 * - DialogBody scrolls when the content is taller than the viewport; header and footer stay put.
 *   When a <form> wraps header/body/footer use DialogForm (a flex column) so the body can scroll.
 * - DialogFooter: put the secondary button first, the primary last. Right-aligned on desktop,
 *   full-width and stacked (primary on top) on mobile.
 * - preventClose: while true, Escape / outside click / the X button do nothing (use while pending).
 * - hideClose: hide the corner X.
 * - Opening and closing fade + scale (disabled under prefers-reduced-motion). Focus is trapped.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

const SIZE_CLASS = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export type DialogSize = keyof typeof SIZE_CLASS;

export function DialogOverlay({ className, ...props }: DialogPrimitive.DialogOverlayProps) {
  return <DialogPrimitive.Overlay className={cn('rc-overlay fixed inset-0 z-50 bg-[#1d2025]/45', className)} {...props} />;
}

export interface DialogContentProps extends DialogPrimitive.DialogContentProps {
  size?: DialogSize;
  /** Block Escape, outside clicks and the close button (e.g. while a request is pending). */
  preventClose?: boolean;
  hideClose?: boolean;
}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  { className, children, size = 'md', preventClose = false, hideClose = false, onEscapeKeyDown, onPointerDownOutside, onInteractOutside, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'rc-pop fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border border-border bg-background p-6 shadow-[0_16px_48px_rgba(29,32,37,0.22)] focus:outline-none',
          SIZE_CLASS[size],
          className,
        )}
        onEscapeKeyDown={(event) => {
          if (preventClose) event.preventDefault();
          onEscapeKeyDown?.(event);
        }}
        onPointerDownOutside={(event) => {
          if (preventClose) event.preventDefault();
          onPointerDownOutside?.(event);
        }}
        onInteractOutside={(event) => {
          if (preventClose) event.preventDefault();
          onInteractOutside?.(event);
        }}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            disabled={preventClose}
            className="absolute right-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex shrink-0 flex-col gap-1.5 pr-8', className)} {...props} />;
}
export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold leading-snug tracking-tight', className)} {...props} />;
}
export function DialogDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
}

/** The scrolling middle of a dialog. Stretches to the dialog's edges so the scrollbar sits at the border. */
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('-mx-6 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-0.5', className)} {...props} />;
}

/** A <form> laid out as a flex column so a DialogBody inside it can scroll. */
export const DialogForm = React.forwardRef<HTMLFormElement, React.FormHTMLAttributes<HTMLFormElement>>(function DialogForm(
  { className, ...props },
  ref,
) {
  return <form ref={ref} className={cn('flex min-h-0 flex-1 flex-col', className)} {...props} />;
});

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-6 flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  );
}
