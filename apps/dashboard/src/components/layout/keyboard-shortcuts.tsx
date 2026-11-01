'use client';

/**
 * Global keyboard shortcuts for the console and the dialog that lists them.
 *
 *   ⌘K / Ctrl+K   open the command palette (works even while typing)
 *   /             open the command palette
 *   ?             show this list
 *   [             collapse / expand the sidebar
 *   g then h|w|a|s|m|k   go to Account home / Websites / Analytics / Storage / Members / API keys
 *
 * Single-key shortcuts are ignored while focus is in a text field or a dialog/menu is open.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { startRouteProgress } from './route-progress';
import { useShell } from './shell-context';

const GO_TO: Record<string, { href: string; label: string }> = {
  h: { href: '/dashboard', label: 'Account home' },
  w: { href: '/zones', label: 'Websites' },
  a: { href: '/analytics', label: 'Analytics' },
  s: { href: '/storage', label: 'Storage' },
  m: { href: '/settings/members', label: 'Members' },
  k: { href: '/settings/api-keys', label: 'API keys' },
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function overlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]');
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** isMac() after hydration (false on the server and the first client render, to avoid a mismatch). */
export function useIsMac(): boolean {
  const [mac, setMac] = React.useState(false);
  React.useEffect(() => setMac(isMac()), []);
  return mac;
}

/** Installs the global key handler. Mount once (AppShell does). */
export function useGlobalShortcuts() {
  const router = useRouter();
  const { setPaletteOpen, paletteOpen, openShortcuts, toggleSidebar } = useShell();
  const pendingG = React.useRef<number | null>(null);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTyping(event.target) || overlayOpen()) return;

      if (pendingG.current !== null) {
        const dest = GO_TO[event.key.toLowerCase()];
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        if (dest) {
          event.preventDefault();
          startRouteProgress(dest.href);
          router.push(dest.href);
          return;
        }
      }

      if (event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === '?') {
        event.preventDefault();
        openShortcuts();
      } else if (event.key === '[') {
        event.preventDefault();
        toggleSidebar();
      } else if (event.key === 'g') {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 1200);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router, setPaletteOpen, paletteOpen, openShortcuts, toggleSidebar]);
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) =>
        k === 'then' ? (
          <span key={i} className="px-0.5 text-xs text-muted-foreground">
            then
          </span>
        ) : (
          <kbd
            key={i}
            className="min-w-[22px] rounded-md border border-border border-b-border-strong bg-muted px-1.5 py-0.5 text-center font-sans text-xs font-medium text-foreground"
          >
            {k}
          </kbd>
        ),
      )}
    </span>
  );
}

export function KeyboardShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useShell();
  const mod = isMac() ? '⌘' : 'Ctrl';
  const groups: { title: string; rows: { label: string; keys: string[] }[] }[] = [
    {
      title: 'General',
      rows: [
        { label: 'Search or jump to…', keys: [mod, 'K'] },
        { label: 'Search or jump to… (when not typing)', keys: ['/'] },
        { label: 'Show keyboard shortcuts', keys: ['?'] },
        { label: 'Collapse or expand the sidebar', keys: ['['] },
        { label: 'Close a dialog or menu', keys: ['Esc'] },
      ],
    },
    {
      title: 'Go to',
      rows: Object.entries(GO_TO).map(([key, dest]) => ({ label: dest.label, keys: ['G', 'then', key.toUpperCase()] })),
    },
  ];
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move around the console without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <DialogBody className="gap-5">
          {groups.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{group.title}</h3>
              <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
                {group.rows.map((row) => (
                  <li key={row.label} className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]">
                    <span>{row.label}</span>
                    <Keys keys={row.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
