'use client';

/**
 * Tooltip (Radix) — a short label for icon-only buttons and the collapsed sidebar.
 * Opens on hover after 300 ms and immediately on keyboard focus; Escape closes.
 *
 *   import { Tooltip } from '@/components/ui/tooltip';
 *   <Tooltip content="Copy hostname"><Button size="icon-sm" aria-label="Copy hostname">…</Button></Tooltip>
 *
 * Props: content (ReactNode; falsy renders the child alone), side ('top' | 'right' | 'bottom' | 'left',
 *   default 'top'), align, delay (ms, default 300), shortcut (shown as a key hint), disabled.
 * The child must be a single focusable element that forwards refs (Button, Link, button…).
 * Still give icon-only buttons an aria-label — the tooltip is a visual aid, not their name.
 * `TooltipProvider` is mounted in the app layout (shared delay, skip-delay between tooltips);
 * a Tooltip outside it provides its own.
 */
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

const HasProvider = React.createContext(false);

export function TooltipProvider({ children, delay = 300 }: { children: React.ReactNode; delay?: number }) {
  return (
    <TooltipPrimitive.Provider delayDuration={delay} skipDelayDuration={250}>
      <HasProvider.Provider value>{children}</HasProvider.Provider>
    </TooltipPrimitive.Provider>
  );
}

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delay?: number;
  shortcut?: string;
  disabled?: boolean;
  className?: string;
}

export function Tooltip({ content, children, side = 'top', align = 'center', delay, shortcut, disabled, className }: TooltipProps) {
  const hasProvider = React.useContext(HasProvider);
  const [open, setOpen] = React.useState(false);
  const hovered = React.useRef(false);
  if (!content || disabled) return children;

  // Only open for a real hover or keyboard focus. Programmatic focus (e.g. a menu or dialog
  // returning focus to its trigger after a mouse click) is not :focus-visible, so no tooltip.
  const onOpenChange = (next: boolean) => {
    if (next && !hovered.current) {
      const active = document.activeElement;
      let keyboard = true;
      try {
        keyboard = !active || active.matches(':focus-visible');
      } catch {
        keyboard = true; // selector unsupported (jsdom): allow
      }
      if (!keyboard) return;
    }
    setOpen(next);
  };

  const tip = (
    <TooltipPrimitive.Root delayDuration={delay} open={open} onOpenChange={onOpenChange}>
      <TooltipPrimitive.Trigger
        asChild
        onPointerEnter={() => (hovered.current = true)}
        onPointerLeave={() => (hovered.current = false)}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'rc-tooltip z-[70] flex max-w-64 items-center gap-2 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-[0_4px_12px_rgba(29,32,37,0.2)]',
            className,
          )}
        >
          {content}
          {shortcut && <kbd className="rounded border border-white/20 px-1 font-sans text-[11px] text-white/70">{shortcut}</kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );

  return hasProvider ? tip : <TooltipProvider delay={delay}>{tip}</TooltipProvider>;
}
