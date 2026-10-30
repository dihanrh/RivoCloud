'use client';

/**
 * AppShell — the post-login frame: route progress bar, top bar, sidebar (desktop rail /
 * mobile drawer), the content column (max 1200px), the command palette, the keyboard
 * shortcuts dialog and the global hotkeys. Mounted by src/app/(app)/layout.tsx inside
 * ToastProvider + TooltipProvider.
 */
import { CommandPalette } from '@/components/command/command-palette';
import { KeyboardShortcutsDialog, useGlobalShortcuts } from './keyboard-shortcuts';
import { RouteProgress } from './route-progress';
import { ShellProvider } from './shell-context';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

export function AppShell({ children, initialCollapsed = false }: { children: React.ReactNode; initialCollapsed?: boolean }) {
  return (
    <ShellProvider initialCollapsed={initialCollapsed}>
      <ShellFrame>{children}</ShellFrame>
    </ShellProvider>
  );
}

function ShellFrame({ children }: { children: React.ReactNode }) {
  useGlobalShortcuts();
  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only z-[90] rounded-md bg-background px-3 py-2 text-[13px] font-medium shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <RouteProgress />
      <TopBar />
      <div className="flex">
        <Sidebar />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1200px]">{children}</div>
        </main>
      </div>
      <CommandPalette />
      <KeyboardShortcutsDialog />
    </div>
  );
}
