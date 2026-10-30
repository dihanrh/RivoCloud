'use client';

/**
 * Sidebar. Desktop (lg+): sticky 240px column that collapses to a 64px icon rail (toggle at the
 * bottom or "[", remembered via ShellProvider; tooltips label the icons when collapsed).
 * Mobile: the same nav inside a left Sheet (overlay, focus trap, closes on navigation).
 * In a website (zone) context the nav switches to that website's sections with a website
 * switcher at the top that keeps you on the same section when jumping to another website.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronsUpDown, Globe, LayoutList, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { BrandLockup } from '@/components/brand/brand';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip } from '@/components/ui/tooltip';
import { useMe } from '@/hooks/use-me';
import { useZone } from '@/hooks/use-zone';
import { useZones } from '@/hooks/use-zones';
import { canViewAuditLog } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { ACCOUNT_NAV, isActive, zoneIdFromPath, zoneNav, type NavItem, type NavSection } from './nav-config';
import { startRouteProgress } from './route-progress';
import { useShell } from './shell-context';
import { AccountSwitcher } from './top-bar';

export function Sidebar() {
  const { sidebarCollapsed: collapsed, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useShell();
  const pathname = usePathname();

  // Close the drawer after any navigation.
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  return (
    <>
      <aside
        aria-label="Primary"
        data-collapsed={collapsed || undefined}
        className={cn(
          'sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ease-out lg:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3 [scrollbar-width:thin]">
          <SidebarNav collapsed={collapsed} />
        </div>
        <div className={cn('border-t border-border p-2', collapsed && 'flex justify-center')}>
          <Tooltip content={collapsed ? 'Expand sidebar' : undefined} side="right" shortcut="[">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                collapsed ? 'w-10 justify-center' : 'w-full px-2.5',
              )}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Collapse</span>
                  <kbd className="rounded border border-border px-1 font-sans text-[11px]">[</kbd>
                </>
              )}
            </button>
          </Tooltip>
        </div>
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" size="sm" className="w-[288px] max-w-[85vw] lg:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Console sections</SheetDescription>
          <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
            <BrandLockup />
          </div>
          <div className="border-b border-border p-3">
            <AccountSwitcher inDrawer />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            <SidebarNav collapsed={false} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const { data: me } = useMe();
  const zoneId = zoneIdFromPath(pathname);

  if (zoneId) {
    return (
      <>
        <ZoneHeader zoneId={zoneId} pathname={pathname} collapsed={collapsed} />
        <NavSections sections={zoneNav(zoneId)} pathname={pathname} collapsed={collapsed} canAudit />
      </>
    );
  }
  return <NavSections sections={ACCOUNT_NAV} pathname={pathname} collapsed={collapsed} canAudit={canViewAuditLog(me?.role ?? null)} />;
}

function ZoneHeader({ zoneId, pathname, collapsed }: { zoneId: string; pathname: string | null; collapsed: boolean }) {
  return (
    <div className={cn('mb-3 border-b border-border pb-3', collapsed ? 'flex flex-col items-center gap-1 px-2' : 'px-3')}>
      <Tooltip content={collapsed ? 'All websites' : undefined} side="right">
        <Link
          href="/zones"
          aria-label={collapsed ? 'All websites' : undefined}
          className={cn(
            'flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            collapsed ? 'h-9 w-10 justify-center' : 'mb-2 px-2 py-1',
          )}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed && 'All websites'}
        </Link>
      </Tooltip>
      <ZoneSwitcher zoneId={zoneId} pathname={pathname} collapsed={collapsed} />
    </div>
  );
}

function ZoneSwitcher({ zoneId, pathname, collapsed }: { zoneId: string; pathname: string | null; collapsed: boolean }) {
  const router = useRouter();
  const { data: zone } = useZone(zoneId);
  const { data: zonesData } = useZones();
  const { data: me } = useMe();
  const zones = zonesData?.zones ?? [];
  const canCreate = !!me?.role && me.role !== 'viewer';
  const name = zone?.name ?? 'Loading…';

  // Keep the same section when jumping to another website (/zones/A/caching → /zones/B/caching).
  const subpath = pathname?.replace(/^\/zones\/[^/]+/, '') ?? '';
  const go = (href: string) => {
    startRouteProgress(href);
    router.push(href);
  };

  const trigger = collapsed ? (
    <button
      type="button"
      aria-label={`Website: ${name}. Switch website`}
      className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-[13px] font-semibold text-foreground transition-colors hover:border-border-strong data-[state=open]:border-primary/40"
    >
      {zone ? zone.name[0]?.toUpperCase() : <Globe className="h-4 w-4" aria-hidden />}
    </button>
  ) : (
    <button
      type="button"
      aria-label={`Website: ${name}. Switch website`}
      className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left shadow-[0_1px_0_rgba(29,32,37,0.04)] transition-colors hover:border-border-strong hover:bg-muted data-[state=open]:border-primary/40 data-[state=open]:bg-muted"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary" aria-hidden>
        <Globe className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-5" title={zone?.name}>
          {name}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {zone && (
            <>
              <span className={cn('h-1.5 w-1.5 rounded-full', zone.enabled ? 'bg-success' : 'bg-border-strong')} aria-hidden />
              {zone.enabled ? 'Active' : 'Paused'}
            </>
          )}
        </span>
      </span>
      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );

  return (
    <DropdownMenu>
      <Tooltip content={collapsed ? name : undefined} side="right">
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-64">
        <MenuLabel>Switch website</MenuLabel>
        <div className="max-h-64 overflow-y-auto">
          {zones.map((z) => (
            <MenuItem
              key={z.id}
              icon={<Globe />}
              description={z.originUrl}
              trailing={z.id === zoneId ? <Check className="text-primary" aria-label="Current website" /> : undefined}
              onSelect={() => z.id !== zoneId && go(`/zones/${z.id}${subpath}`)}
            >
              {z.name}
            </MenuItem>
          ))}
        </div>
        <MenuSeparator />
        <MenuItem icon={<LayoutList />} onSelect={() => go('/zones')}>
          All websites
        </MenuItem>
        {canCreate && (
          <MenuItem icon={<Plus />} onSelect={() => go('/zones?create=1')}>
            Add a website
          </MenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavSections({
  sections,
  pathname,
  collapsed,
  canAudit,
}: {
  sections: NavSection[];
  pathname: string | null;
  collapsed: boolean;
  canAudit: boolean;
}) {
  return (
    <nav aria-label="Sections" className="flex flex-col gap-4">
      {sections.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title &&
            (collapsed ? (
              <div className="mx-4 mb-2 border-t border-border" aria-hidden />
            ) : (
              <p className="px-5 pb-1 text-xs font-semibold text-muted-foreground">{section.title}</p>
            ))}
          <ul className="flex flex-col gap-0.5">
            {section.items
              .filter((item) => item.requires !== 'audit' || canAudit)
              .map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(item, pathname)} collapsed={collapsed} />
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Tooltip content={collapsed ? item.label : undefined} side="right">
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          'relative mx-3 flex h-8 items-center gap-2.5 rounded-md text-[13px] text-foreground transition-colors hover:bg-muted',
          collapsed ? 'justify-center px-0' : 'px-2.5',
          active && 'bg-primary-soft font-semibold text-primary hover:bg-primary-soft',
        )}
      >
        {active && (
          <span
            className="absolute -left-3 bottom-1 top-1 w-[3px] rounded-r"
            style={{ background: 'var(--brand-gradient)' }}
            aria-hidden
          />
        )}
        <Icon className={cn('h-4 w-4 shrink-0', !active && 'text-muted-foreground')} aria-hidden />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    </Tooltip>
  );
}
