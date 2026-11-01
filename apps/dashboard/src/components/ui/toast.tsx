'use client';

/**
 * Toasts — transient feedback after an action.
 *
 *   // once, in the (app) layout (already done):
 *   <ToastProvider>{children}</ToastProvider>
 *
 *   // anywhere below it:
 *   import { useToast } from '@/components/ui/toast';
 *   const toast = useToast();
 *   toast.success('Bucket deleted');
 *   toast.error('Could not delete bucket', 'The bucket is not empty.');
 *   toast.info('Purge queued', 'It can take up to a minute.');
 *   const id = toast.info('Uploading…', undefined, { duration: Infinity }); toast.dismiss(id);
 *
 * Bottom-right stack (bottom-centre on mobile), newest at the bottom, max 5 visible.
 * Auto-dismiss after 5 s (errors 8 s); hovering or focusing the stack pauses every timer.
 * Each toast has a close button. Success/info use role="status" (polite), errors role="alert".
 * Outside a provider, useToast() returns a no-op so primitives that toast never crash in tests.
 */
import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  /** Milliseconds before auto-dismiss; Infinity keeps it until dismissed. */
  duration?: number;
}

export interface ToastApi {
  success: (title: string, description?: React.ReactNode, options?: ToastOptions) => string;
  error: (title: string, description?: React.ReactNode, options?: ToastOptions) => string;
  info: (title: string, description?: React.ReactNode, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: React.ReactNode;
  duration: number;
  closing: boolean;
}

const DEFAULT_DURATION: Record<ToastTone, number> = { success: 5000, info: 5000, error: 8000 };
const EXIT_MS = 160;
const MAX_VISIBLE = 5;

const noop: ToastApi = {
  success: () => '',
  error: () => '',
  info: () => '',
  dismiss: () => {},
};

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  return React.useContext(ToastContext) ?? noop;
}

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [paused, setPaused] = React.useState(false);

  const remove = React.useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const dismiss = React.useCallback(
    (id: string) => {
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, closing: true } : t)));
      setTimeout(() => remove(id), EXIT_MS);
    },
    [remove],
  );

  const push = React.useCallback(
    (tone: ToastTone, title: string, description?: React.ReactNode, options?: ToastOptions) => {
      counter += 1;
      const id = `toast-${counter}`;
      const item: ToastItem = { id, tone, title, description, duration: options?.duration ?? DEFAULT_DURATION[tone], closing: false };
      setToasts((list) => [...list, item].slice(-MAX_VISIBLE));
      return id;
    },
    [],
  );

  const api = React.useMemo<ToastApi>(
    () => ({
      success: (title, description, options) => push('success', title, description, options),
      error: (title, description, options) => push('error', title, description, options),
      info: (title, description, options) => push('info', title, description, options),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end sm:p-6"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} paused={paused} onDismiss={() => dismiss(t.id)} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

const TONE = {
  success: { icon: CheckCircle2, iconClass: 'text-success', bar: 'bg-success' },
  error: { icon: AlertCircle, iconClass: 'text-destructive', bar: 'bg-destructive' },
  info: { icon: Info, iconClass: 'text-primary', bar: 'bg-primary' },
} as const;

function ToastCard({ toast, paused, onDismiss }: { toast: ToastItem; paused: boolean; onDismiss: () => void }) {
  const remaining = React.useRef(toast.duration);
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // Count down only while not paused; resuming continues from what was left.
  React.useEffect(() => {
    if (paused || toast.closing || !Number.isFinite(remaining.current)) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, toast.closing]);

  const tone = TONE[toast.tone];
  const Icon = tone.icon;
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-state={toast.closing ? 'closed' : 'open'}
      data-tone={toast.tone}
      className="rc-toast pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-lg border border-border bg-background py-3 pl-4 pr-10 shadow-[0_8px_28px_rgba(29,32,37,0.16)] sm:w-[360px]"
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', tone.bar)} aria-hidden />
      <Icon className={cn('mt-0.5 h-[18px] w-[18px] shrink-0', tone.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-5">{toast.title}</p>
        {toast.description && <div className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{toast.description}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
