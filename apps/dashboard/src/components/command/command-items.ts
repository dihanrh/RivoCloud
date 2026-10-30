/**
 * Command palette data: building the item list and ranking it against a query.
 * Pure functions (no React) so they are easy to test.
 *
 * Quick actions navigate to list pages with a query param that the page reads to open its
 * create/invite dialog on arrival (phase 2 wires the pages to these):
 *   /zones?create=1              → "Add a website" dialog
 *   /storage?create=1            → "Create bucket" dialog
 *   /settings/members?invite=1   → "Invite member" dialog
 *   /settings/api-keys?create=1  → "Create API key" dialog
 */
import {
  Database,
  FolderPlus,
  Globe,
  KeyRound,
  Keyboard,
  Plus,
  UserPlus,
  Building2,
  type LucideIcon,
} from 'lucide-react';
import { canManageMembers, canViewAuditLog } from '@/lib/rbac';
import type { Bucket, OrgRole, Zone } from '@/lib/types';
import { zoneHostname } from '@/lib/zone-hostname';
import { ACCOUNT_NAV, zoneNav } from '@/components/layout/nav-config';

export type CommandGroup = 'Recent' | 'Pages' | 'This website' | 'Websites' | 'Buckets' | 'Actions';

export const GROUP_ORDER: CommandGroup[] = ['Recent', 'This website', 'Pages', 'Websites', 'Buckets', 'Actions'];

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  sublabel?: string;
  icon: LucideIcon;
  /** Navigate here on select… */
  href?: string;
  /** …or run this (e.g. open the shortcuts dialog). */
  action?: 'shortcuts';
  keywords?: string[];
}

export const QUICK_ACTION_PARAMS = {
  addWebsite: '/zones?create=1',
  createBucket: '/storage?create=1',
  inviteMember: '/settings/members?invite=1',
  createApiKey: '/settings/api-keys?create=1',
} as const;

export function buildCommandItems({
  role,
  zones = [],
  buckets = [],
  zone,
}: {
  role: OrgRole | null | undefined;
  zones?: Zone[];
  buckets?: Bucket[];
  /** The website currently open (zone context), for its section pages. */
  zone?: Pick<Zone, 'id' | 'name'> | null;
}): CommandItem[] {
  const items: CommandItem[] = [];
  const canWrite = !!role && role !== 'viewer';

  for (const section of ACCOUNT_NAV) {
    for (const nav of section.items) {
      if (nav.requires === 'audit' && !canViewAuditLog(role)) continue;
      items.push({ id: `page:${nav.href}`, group: 'Pages', label: nav.label, icon: nav.icon, href: nav.href, keywords: section.title ? [section.title] : undefined });
    }
  }

  if (zone) {
    for (const section of zoneNav(zone.id)) {
      for (const nav of section.items) {
        items.push({ id: `zone-page:${nav.href}`, group: 'This website', label: nav.label, sublabel: zone.name, icon: nav.icon, href: nav.href });
      }
    }
  }

  for (const z of zones) {
    items.push({
      id: `zone:${z.id}`,
      group: 'Websites',
      label: z.name,
      sublabel: z.originUrl,
      icon: Globe,
      href: `/zones/${z.id}`,
      keywords: [z.slug, zoneHostname(z)],
    });
  }

  for (const b of buckets) {
    items.push({ id: `bucket:${b.id}`, group: 'Buckets', label: b.name, sublabel: b.region, icon: Database, href: `/storage/${b.id}` });
  }

  if (canWrite) {
    items.push({ id: 'action:add-website', group: 'Actions', label: 'Add a website', icon: Plus, href: QUICK_ACTION_PARAMS.addWebsite, keywords: ['new', 'create', 'zone', 'domain'] });
    items.push({ id: 'action:create-bucket', group: 'Actions', label: 'Create bucket', icon: FolderPlus, href: QUICK_ACTION_PARAMS.createBucket, keywords: ['new', 'storage'] });
    items.push({ id: 'action:create-api-key', group: 'Actions', label: 'Create API key', icon: KeyRound, href: QUICK_ACTION_PARAMS.createApiKey, keywords: ['new', 'token'] });
  }
  if (canManageMembers(role)) {
    items.push({ id: 'action:invite-member', group: 'Actions', label: 'Invite member', icon: UserPlus, href: QUICK_ACTION_PARAMS.inviteMember, keywords: ['add', 'user', 'team'] });
  }
  items.push({ id: 'action:create-account', group: 'Actions', label: 'Create an account', icon: Building2, href: '/orgs/new', keywords: ['organization', 'new'] });
  items.push({ id: 'action:shortcuts', group: 'Actions', label: 'Keyboard shortcuts', icon: Keyboard, action: 'shortcuts', keywords: ['help', 'keys'] });

  return items;
}

function score(item: CommandItem, q: string): number {
  const label = item.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.split(/[\s.\-_/]+/).some((w) => w.startsWith(q))) return 60;
  if (label.includes(q)) return 40;
  const extra = [item.sublabel, ...(item.keywords ?? [])].filter(Boolean).map((s) => s!.toLowerCase());
  if (extra.some((s) => s.startsWith(q))) return 30;
  if (extra.some((s) => s.includes(q))) return 20;
  return 0;
}

/** Live results (websites/buckets) shown per group: a few when idle, more when searching. */
const IDLE_LIMIT = 4;
const QUERY_LIMIT = 8;

/**
 * Filter + rank. Empty query: current website pages, pages, the first few websites/buckets, actions.
 * With a query: every group, matches only, best first within each group.
 * Every query token must match (so "acme cach" finds "Caching — acme.com").
 */
export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  const limited = (group: CommandGroup) => group === 'Websites' || group === 'Buckets';
  if (!q) {
    const counts: Partial<Record<CommandGroup, number>> = {};
    return sortByGroup(
      items.filter((item) => {
        if (!limited(item.group)) return true;
        counts[item.group] = (counts[item.group] ?? 0) + 1;
        return counts[item.group]! <= IDLE_LIMIT;
      }),
    );
  }
  const tokens = q.split(/\s+/);
  const scored = items
    .map((item) => {
      const scores = tokens.map((t) => score(item, t));
      return { item, s: scores.every((x) => x > 0) ? scores.reduce((a, b) => a + b, 0) : 0 };
    })
    .filter((x) => x.s > 0);
  const counts: Partial<Record<CommandGroup, number>> = {};
  const byGroup = sortByGroup(scored.sort((a, b) => b.s - a.s).map((x) => x.item));
  return byGroup.filter((item) => {
    if (!limited(item.group)) return true;
    counts[item.group] = (counts[item.group] ?? 0) + 1;
    return counts[item.group]! <= QUERY_LIMIT;
  });
}

function sortByGroup(items: CommandItem[]): CommandItem[] {
  // Stable sort keeps the within-group order (rank or natural).
  return [...items].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}
