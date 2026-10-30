'use client';

/**
 * Sheet — a side drawer (Radix Dialog) for long create/edit forms (> 6 fields)
 * and for the mobile navigation drawer.
 *
 *   import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
 *            SheetBody, SheetFooter, SheetClose } from '@/components/ui/sheet';
 *
 *   <Sheet open={open} onOpenChange={setOpen}>
 *     <SheetContent side="right" size="md" preventClose={pending}>
 *       <form className="flex min-h-0 flex-1 flex-col" onSubmit={…}>
 *         <SheetHeader><SheetTitle>Add cache rule</SheetTitle><SheetDescription>…</SheetDescription></SheetHeader>
 *         <SheetBody>…fields…</SheetBody>
 *         <SheetFooter>
 *           <SheetClose asChild><Button variant="secondary">Cancel</Button></SheetClose>
 *           <Button type="submit" loading={pending}>Save rule</Button>
 *         </SheetFooter>
 *       </form>
 *     </SheetContent>
 *   </Sheet>
 *
 * side: right (default) | left.  size: sm (320px) | md (480px, default) | lg (640px).
 * Header and footer are pinned; SheetBody scrolls. Focus is trapped, Escape closes unless preventClose.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DialogOverlay } from './dialog';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const SIZE = { sm: 'sm:max-w-xs', md: 'sm:max-w-[480px]', lg: 'sm:max-w-[640px]' } as const;

export interface SheetContentProps extends DialogPrimitive.DialogContentProps {
  side?: 'right' | 'left';
  size?: keyof typeof SIZE;
  preventClose?: boolean;
  hideClose?: boolean;
}

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(function SheetContent(
  { className, children, side = 'right', size = 'md', preventClose = false, hideClose = false, onEscapeKeyDown, onPointerDownOutside, onInteractOutside, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-y-0 z-50 flex w-full flex-col bg-background shadow-[0_16px_48px_rgba(29,32,37,0.22)] focus:outline-none',
          side === 'right' ? 'rc-sheet-right right-0 border-l border-border' : 'rc-sheet-left left-0 border-r border-border',
          SIZE[size],
          className,
        )}
        onEscapeKeyDown={(e) => {
          if (preventClose) e.preventDefault();
          onEscapeKeyDown?.(e);
        }}
        onPointerDownOutside={(e) => {
          if (preventClose) e.preventDefault();
          onPointerDownOutside?.(e);
        }}
        onInteractOutside={(e) => {
          if (preventClose) e.preventDefault();
          onInteractOutside?.(e);
        }}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            disabled={preventClose}
            className="absolute right-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex shrink-0 flex-col gap-1 border-b border-border px-6 py-4 pr-12', className)} {...props} />;
}
export function SheetTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className={cn('text-base font-semibold', className)} {...props} />;
}
export function SheetDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
}
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5', className)} {...props} />;
}
export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-muted px-6 py-3 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  );
}
