'use client';

/**
 * Shell state shared by the top bar, sidebar, command palette and global shortcuts:
 * palette / shortcuts-dialog / mobile-nav open state and the persisted sidebar collapse.
 *
 *   import { useShell } from '@/components/layout/shell-context';
 *   const { openPalette, openShortcuts, sidebarCollapsed, toggleSidebar } = useShell();
 *
 * Sidebar collapse is remembered in localStorage (`rc.sidebar.collapsed`) and mirrored to a
 * cookie (`rc_sidebar`) so the server renders the right width on the next load (no flicker).
 */
import * as React from 'react';
import { SIDEBAR_COOKIE, SIDEBAR_STORAGE_KEY } from './shell-constants';

export { SIDEBAR_COOKIE, SIDEBAR_STORAGE_KEY };

interface ShellState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  openPalette: () => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  openShortcuts: () => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const ShellContext = React.createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <ShellProvider>.');
  return ctx;
}

function readStoredCollapsed(): boolean | null {
  try {
    const v = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

export function ShellProvider({ children, initialCollapsed = false }: { children: React.ReactNode; initialCollapsed?: boolean }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(initialCollapsed);

  // localStorage is the source of truth; the cookie only seeds the server render.
  React.useEffect(() => {
    const stored = readStoredCollapsed();
    if (stored !== null) setSidebarCollapsed(stored);
  }, []);

  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Storage can be unavailable (private mode); the toggle still works for this visit.
      }
      document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  const value = React.useMemo<ShellState>(
    () => ({
      paletteOpen,
      setPaletteOpen,
      openPalette: () => setPaletteOpen(true),
      shortcutsOpen,
      setShortcutsOpen,
      openShortcuts: () => setShortcutsOpen(true),
      mobileNavOpen,
      setMobileNavOpen,
      sidebarCollapsed,
      toggleSidebar,
    }),
    [paletteOpen, shortcutsOpen, mobileNavOpen, sidebarCollapsed, toggleSidebar],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
