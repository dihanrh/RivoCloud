'use client';

/**
 * Top bar (56px): mobile nav button, brand lockup, account switcher, the
 * "Search or jump to…" button (opens the command palette), help menu and profile menu.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Building2,
  Check,
  ChevronsUpDown,
  CircleHelp,
  ExternalLink,
  Keyboard,
  LogOut,
  Menu,
  Activity,
  Plus,
  Search,
} from 'lucide-react';
import { BrandLockup } from '@/components/brand/brand';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { useMe } from '@/hooks/use-me';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelectOrg } from '@/hooks/use-select-org';
import { errorMessage } from '@/lib/http';
import { cn } from '@/lib/utils';
import { useIsMac } from './keyboard-shortcuts';
import { startRouteProgress } from './route-progress';
import { useShell } from './shell-context';

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  viewer: 'Viewer',
};

export function initialsOf(text: string | null | undefined): string {
  return (
    (text || '?')
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

/** Square monogram for an account (org). Colour is stable per name. */
export function OrgAvatar({ name, className }: { name: string | undefined; className?: string }) {
  const palette = ['#d6246a', '#5b2a8c', '#c75f00', '#1e7d3a', '#1f6feb', '#8a3ffc'];
  const hash = Array.from(name ?? '').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <span
      aria-hidden
      className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white', className)}
      style={{ background: name ? palette[hash % palette.length] : 'var(--color-border-strong)' }}
    >
      {initialsOf(name).slice(0, 1)}
    </span>
  );
}

export function TopBar() {
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        aria-label="Open navigation"
        aria-expanded={mobileNavOpen}
      >
        <Menu className="!size-5" />
      </Button>
      <BrandLockup className="shrink-0" />
      <span className="mx-1.5 hidden h-6 w-px bg-border sm:block" aria-hidden />
      <AccountSwitcher />
      <div className="flex flex-1 justify-end md:justify-center">
        <SearchButton />
      </div>
      <div className="flex items-center gap-0.5">
        <HelpMenu />
        <ProfileMenu />
      </div>
    </header>
  );
}

function SearchButton() {
  const { openPalette } = useShell();
  const mac = useIsMac();
  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        className="group hidden h-9 w-full max-w-[420px] items-center gap-2.5 rounded-lg border border-border bg-muted px-3 text-[13px] text-muted-foreground transition-colors hover:border-border-strong hover:bg-background md:flex"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-px font-sans text-[11px] font-medium text-muted-foreground">
          {mac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>
      <Tooltip content="Search or jump to…">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={openPalette} aria-label="Search or jump to…">
          <Search />
        </Button>
      </Tooltip>
    </>
  );
}

/** Account (org) switcher. `inDrawer` renders the full-width variant used in the mobile nav drawer. */
export function AccountSwitcher({ inDrawer = false }: { inDrawer?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { data: me } = useMe();
  const { data: orgs } = useOrgs();
  const selectOrg = useSelectOrg();
  const current = orgs?.find((o) => o.id === me?.orgId);

  async function switchTo(orgId: string, name: string) {
    if (orgId === me?.orgId) return;
    try {
      await selectOrg.mutateAsync(orgId);
      startRouteProgress('/dashboard');
      router.push('/dashboard');
      router.refresh();
      toast.success(`Switched to ${name}`);
    } catch (err) {
      toast.error('Could not switch account', errorMessage(err, 'Try again in a moment.'));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account: ${current?.name ?? 'none selected'}. Switch account`}
          className={cn(
            'h-9 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors hover:bg-muted data-[state=open]:bg-muted',
            inDrawer ? 'flex w-full border border-border' : 'hidden max-w-60 sm:flex',
          )}
        >
          <OrgAvatar name={current?.name} />
          <span className={cn('truncate', inDrawer && 'flex-1 text-left')}>{current?.name ?? 'Select an account'}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={inDrawer ? 'w-[var(--radix-dropdown-menu-trigger-width)]' : 'w-72'}>
        <MenuLabel>Accounts</MenuLabel>
        {orgs?.map((org) => (
          <MenuItem
            key={org.id}
            disabled={selectOrg.isPending}
            onSelect={() => void switchTo(org.id, org.name)}
            icon={<OrgAvatar name={org.name} className="h-5 w-5 text-[10px]" />}
            trailing={org.id === me?.orgId ? <Check className="text-primary" aria-label="Current account" /> : undefined}
            className={cn(org.id === me?.orgId && 'font-semibold')}
          >
            {org.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          icon={<Plus />}
          onSelect={() => {
            startRouteProgress('/orgs/new');
            router.push('/orgs/new');
          }}
        >
          Create an account
        </MenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HelpMenu() {
  const { openShortcuts } = useShell();
  return (
    <DropdownMenu>
      <Tooltip content="Help">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Help" className="text-muted-foreground data-[state=open]:bg-muted">
            <CircleHelp className="!size-[18px]" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <MenuItem asChild>
          <a href="#">
            <BookOpen className="text-muted-foreground" />
            <span className="flex-1">Documentation</span>
            <ExternalLink className="!size-3.5 text-muted-foreground" />
          </a>
        </MenuItem>
        <MenuItem icon={<Keyboard />} shortcut="?" onSelectAfterClose={openShortcuts}>
          Keyboard shortcuts
        </MenuItem>
        <MenuItem asChild>
          <a href="#">
            <Activity className="text-muted-foreground" />
            <span className="flex-1">Status</span>
            <ExternalLink className="!size-3.5 text-muted-foreground" />
          </a>
        </MenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileMenu() {
  const router = useRouter();
  const { openShortcuts } = useShell();
  const { data: me } = useMe();
  const [loggingOut, setLoggingOut] = React.useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open profile menu"
          className="ml-1 flex h-9 items-center rounded-full p-0.5 transition-shadow hover:ring-2 hover:ring-border data-[state=open]:ring-2 data-[state=open]:ring-primary/30"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: 'var(--brand-gradient)' }}>
            {initialsOf(me?.name || me?.email)}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white" style={{ background: 'var(--brand-gradient)' }} aria-hidden>
            {initialsOf(me?.name || me?.email)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{me?.name || 'Your profile'}</p>
            <p className="truncate text-xs text-muted-foreground">{me?.email}</p>
          </div>
          {me?.role && (
            <Badge variant="secondary" className="shrink-0">
              {ROLE_LABEL[me.role] ?? me.role}
            </Badge>
          )}
        </div>
        <MenuSeparator />
        <MenuItem icon={<Building2 />} onSelect={() => router.push('/settings/members')}>
          Account members
        </MenuItem>
        <MenuItem icon={<Keyboard />} shortcut="?" onSelectAfterClose={openShortcuts}>
          Keyboard shortcuts
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} disabled={loggingOut} onSelect={() => void logout()}>
          {loggingOut ? 'Logging out…' : 'Log out'}
        </MenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
