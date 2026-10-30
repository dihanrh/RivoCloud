'use client';

/**
 * ConfirmDialog — the only way to confirm an action (never window.confirm).
 *
 *   import { ConfirmDialog } from '@/components/ui/confirm-dialog';
 *
 *   <ConfirmDialog
 *     open={!!deleting}
 *     onOpenChange={(o) => !o && setDeleting(null)}
 *     tone="destructive"
 *     title="Delete bucket"
 *     description={<>This permanently deletes <b>{bucket.name}</b> and every file in it.</>}
 *     confirmLabel="Delete bucket"
 *     requireText={bucket.name}              // type-to-confirm (websites & buckets)
 *     successToast="Bucket deleted"          // or { title, description }
 *     onConfirm={() => deleteBucket.mutateAsync(bucket.id)}
 *   />
 *
 * Or uncontrolled with a trigger: <ConfirmDialog trigger={<Button>…</Button>} … />
 *
 * - onConfirm may return a promise: the confirm button shows `loading`, Cancel/Escape are
 *   blocked while pending, a thrown error is shown inline (role="alert") and the dialog stays
 *   open; on success it closes and fires `successToast` (if given).
 * - requireText: the confirm button stays disabled until the typed text matches exactly.
 * - Error text comes from `errorMessage(err, fallback)` (ApiError body.message) or Error.message.
 */
import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/http';
import { cn } from '@/lib/utils';
import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Input } from './input';
import { useToast } from './toast';

export interface ConfirmDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (uncontrolled use). */
  trigger?: React.ReactElement;
  title: string;
  description?: React.ReactNode;
  /** Extra content between the description and the type-to-confirm field. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive';
  /** When set, the user must type this exact text before confirming. */
  requireText?: string;
  onConfirm: () => Promise<unknown> | unknown;
  successToast?: string | { title: string; description?: React.ReactNode };
  /** Fallback error text when the thrown error carries no message. */
  errorFallback?: string;
}

function messageFrom(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return errorMessage(err, fallback);
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function ConfirmDialog({
  open: openProp,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  requireText,
  onConfirm,
  successToast,
  errorFallback = 'Something went wrong. Try again.',
}: ConfirmDialogProps) {
  const toast = useToast();
  const [innerOpen, setInnerOpen] = React.useState(false);
  const open = openProp ?? innerOpen;
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState('');
  const inputId = React.useId();

  // Reset transient state every time the dialog opens.
  React.useEffect(() => {
    if (open) {
      setError(null);
      setTyped('');
      setPending(false);
    }
  }, [open]);

  const setOpen = (next: boolean) => {
    if (pending && !next) return;
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };

  const matches = !requireText || typed === requireText;

  async function confirm(event?: React.FormEvent) {
    event?.preventDefault();
    if (!matches || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setPending(false);
      if (openProp === undefined) setInnerOpen(false);
      onOpenChange?.(false);
      if (successToast) {
        const t = typeof successToast === 'string' ? { title: successToast } : successToast;
        toast.success(t.title, t.description);
      }
    } catch (err) {
      setPending(false);
      setError(messageFrom(err, errorFallback));
    }
  }

  const destructive = tone === 'destructive';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent size="sm" preventClose={pending} role="alertdialog">
        <form onSubmit={confirm} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className={cn(destructive && 'flex-row items-start gap-3')}>
            {destructive && (
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive-soft text-destructive">
                <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-1.5">
              <DialogTitle>{title}</DialogTitle>
              {description ? (
                <DialogDescription asChild>
                  <div>{description}</div>
                </DialogDescription>
              ) : (
                <DialogDescription className="sr-only">{title}</DialogDescription>
              )}
            </div>
          </DialogHeader>
          {(children || requireText || error) && (
            <DialogBody>
              {children}
              {requireText && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={inputId} className="text-[13px] text-muted-foreground">
                    Type <span className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] font-semibold text-foreground">{requireText}</span> to confirm
                  </label>
                  <Input
                    id={inputId}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={pending}
                    autoFocus
                  />
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="rounded-[var(--radius)] border border-destructive/40 bg-destructive-soft px-3 py-2 text-[13px] text-destructive"
                >
                  {error}
                </div>
              )}
            </DialogBody>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!matches} loading={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
