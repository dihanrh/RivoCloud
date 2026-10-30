import {
  BarChart3,
  Database,
  Globe,
  History,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  Settings,
  ShieldCheck,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Only match the exact path (used for "Overview"-style index routes). */
  exact?: boolean;
  /** Hide unless the viewer may see it. */
  requires?: 'audit';
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const ACCOUNT_NAV: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'Account home', icon: Home },
      { href: '/zones', label: 'Websites', icon: Globe },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/storage', label: 'Storage', icon: Database },
    ],
  },
  {
    title: 'Manage account',
    items: [
      { href: '/settings/members', label: 'Members', icon: Users },
      { href: '/settings/api-keys', label: 'API keys', icon: KeyRound },
      { href: '/settings/audit-log', label: 'Audit log', icon: History, requires: 'audit' },
    ],
  },
];

export function zoneNav(zoneId: string): NavSection[] {
  const base = `/zones/${zoneId}`;
  return [
    {
      items: [
        { href: base, label: 'Overview', icon: LayoutDashboard, exact: true },
        { href: `${base}/analytics`, label: 'Analytics', icon: BarChart3 },
        { href: `${base}/caching`, label: 'Caching', icon: Zap },
        { href: `${base}/domains`, label: 'Custom domains', icon: Link2 },
        { href: `${base}/security`, label: 'Security', icon: ShieldCheck },
        { href: `${base}/settings`, label: 'Settings', icon: Settings },
      ],
    },
  ];
}

/** `/zones/<id>` or `/zones/<id>/...` → the zone id, else null. */
export function zoneIdFromPath(pathname: string | null): string | null {
  const match = pathname?.match(/^\/zones\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isActive(item: NavItem, pathname: string | null): boolean {
  if (!pathname) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
