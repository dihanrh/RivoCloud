'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown, LogOut, Menu, Plus, X } from 'lucide-react';
import { BrandLockup } from '@/components/brand/brand';
import { MenuItem, PopoverMenu } from '@/components/ui/popover-menu';
import { useMe } from '@/hooks/use-me';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelectOrg } from '@/hooks/use-select-org';
import { useZone } from '@/hooks/use-zone';
import { canViewAuditLog } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { ACCOUNT_NAV, isActive, zoneIdFromPath, zoneNav, type NavSection } from './nav-config';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  viewer: 'Viewer',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar onToggleNav={() => setMobileOpen((v) => !v)} navOpen={mobileOpen} />
      <div className="flex">
        <Sidebar pathname={pathname} open={mobileOpen} onNavigate={() => setMobileOpen(false)} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function TopBar({ onToggleNav, navOpen }: { onToggleNav: () => void; navOpen: boolean }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-3 sm:px-4">
      <button
        type="button"
        className="rounded p-1.5 hover:bg-muted lg:hidden"
        onClick={onToggleNav}
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navOpen}
      >
        {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      <BrandLockup />
      <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
      <AccountSwitcher />
      <div className="ml-auto flex items-center gap-1">
        <UserMenu />
      </div>
    </header>
  );
}

function AccountSwitcher() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: orgs } = useOrgs();
  const selectOrg = useSelectOrg();
  const current = orgs?.find((o) => o.id === me?.orgId);

  return (
    <PopoverMenu
      label="Switch account"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className="hidden max-w-56 items-center gap-1.5 rounded px-2 py-1.5 text-[13px] font-medium hover:bg-muted sm:flex"
        >
          <span className="truncate">{current?.name ?? 'Select an account'}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}
    >
      {(close) => (
        <>
          <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground">Accounts</p>
          {orgs?.map((org) => (
            <MenuItem
              key={org.id}
              disabled={selectOrg.isPending}
              onClick={async () => {
                close();
                if (org.id === me?.orgId) return;
                await selectOrg.mutateAsync(org.id);
                router.push('/dashboard');
                router.refresh();
              }}
            >
              <span className="flex-1 truncate">{org.name}</span>
              {org.id === me?.orgId && <Check className="text-primary" aria-label="Current account" />}
            </MenuItem>
          ))}
          <div className="my-1 border-t border-border" />
          <MenuItem
            onClick={() => {
              close();
              router.push('/orgs/new');
            }}
          >
            <Plus /> Create an account
          </MenuItem>
        </>
      )}
    </PopoverMenu>
  );
}

function UserMenu() {
  const router = useRouter();
  const { data: me } = useMe();
  const initials = (me?.name || me?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  return (
    <PopoverMenu
      label="Your profile"
      align="right"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Open profile menu"
          className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials}
          </span>
          <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />
        </button>
      )}
    >
      {() => (
        <>
          <div className="border-b border-border px-3 pb-2.5 pt-2">
            <p className="truncate text-[13px] font-semibold">{me?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{me?.email}</p>
            {me?.role && <p className="mt-1 text-xs text-muted-foreground">{ROLE_LABEL[me.role] ?? me.role}</p>}
          </div>
          <MenuItem onClick={logout}>
            <LogOut /> Log out
          </MenuItem>
        </>
      )}
    </PopoverMenu>
  );
}

function Sidebar({ pathname, open, onNavigate }: { pathname: string | null; open: boolean; onNavigate: () => void }) {
  const { data: me } = useMe();
  const zoneId = zoneIdFromPath(pathname);

  return (
    <>
      {open && <div className="fixed inset-0 top-14 z-20 bg-[#1d2025]/30 lg:hidden" onClick={onNavigate} aria-hidden />}
      <aside
        className={cn(
          'fixed bottom-0 left-0 top-14 z-20 w-60 shrink-0 overflow-y-auto border-r border-border bg-background py-3 transition-transform lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary"
      >
        {zoneId ? (
          <ZoneSidebar zoneId={zoneId} pathname={pathname} onNavigate={onNavigate} />
        ) : (
          <NavSections sections={ACCOUNT_NAV} pathname={pathname} onNavigate={onNavigate} canAudit={canViewAuditLog(me?.role ?? null)} />
        )}
      </aside>
    </>
  );
}

function ZoneSidebar({ zoneId, pathname, onNavigate }: { zoneId: string; pathname: string | null; onNavigate: () => void }) {
  const { data: zone } = useZone(zoneId);
  return (
    <>
      <Link
        href="/zones"
        onClick={onNavigate}
        className="mx-3 mb-2 flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] text-primary hover:bg-muted"
      >
        <ArrowLeft className="h-4 w-4" /> All websites
      </Link>
      <div className="mx-5 mb-3 border-b border-border pb-3">
        <p className="truncate text-[15px] font-semibold" title={zone?.name}>
          {zone?.name ?? 'Loading…'}
        </p>
        <p className="truncate text-xs text-muted-foreground">{zone ? (zone.enabled ? 'Active' : 'Paused') : ' '}</p>
      </div>
      <NavSections sections={zoneNav(zoneId)} pathname={pathname} onNavigate={onNavigate} canAudit />
    </>
  );
}

function NavSections({
  sections,
  pathname,
  onNavigate,
  canAudit,
}: {
  sections: NavSection[];
  pathname: string | null;
  onNavigate: () => void;
  canAudit: boolean;
}) {
  return (
    <nav className="flex flex-col gap-4">
      {sections.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title && <p className="px-5 pb-1 text-xs font-semibold text-muted-foreground">{section.title}</p>}
          <ul>
            {section.items
              .filter((item) => item.requires !== 'audit' || canAudit)
              .map((item) => {
                const active = isActive(item, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative mx-3 flex items-center gap-2.5 rounded px-2 py-1.5 text-[13px] text-foreground hover:bg-muted',
                        active && 'bg-primary-soft font-semibold text-primary hover:bg-primary-soft',
                      )}
                    >
                      {active && (
                        <span
                          className="absolute -left-3 top-1 bottom-1 w-[3px] rounded-r"
                          style={{ background: 'var(--brand-gradient)' }}
                          aria-hidden
                        />
                      )}
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
