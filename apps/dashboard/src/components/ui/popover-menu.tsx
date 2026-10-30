'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A small click-to-open menu (account switcher, user menu). Closes on outside
 * click, Escape, or when an item calls `close`.
 */
export function PopoverMenu({
  trigger,
  children,
  align = 'left',
  label,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  label: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            'absolute top-full z-40 mt-1.5 min-w-60 rounded-[var(--radius)] border border-border bg-background py-1 shadow-[0_8px_24px_rgba(29,32,37,0.14)]',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted disabled:opacity-50 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
