'use client';

/**
 * Command palette — "Search or jump to…". Opened with ⌘K / Ctrl+K, "/" (when not typing),
 * or the top-bar search button (all via useShell().openPalette()).
 *
 * Searches account pages, the current website's pages, live websites and buckets
 * (useZones / useBuckets, fetched only while open) and quick actions. ↑/↓ move, Enter opens,
 * Escape closes. The last 5 opened items are remembered in localStorage (`rc.command.recent`).
 * Quick-action URLs are documented in command-items.ts (QUICK_ACTION_PARAMS).
 */
import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, Clock, Loader2, Search } from 'lucide-react';
import { useBuckets } from '@/hooks/use-buckets';
import { useMe } from '@/hooks/use-me';
import { useZones } from '@/hooks/use-zones';
import { cn } from '@/lib/utils';
import { DialogOverlay } from '@/components/ui/dialog';
import { zoneIdFromPath } from '@/components/layout/nav-config';
import { useShell } from '@/components/layout/shell-context';
import { startRouteProgress } from '@/components/layout/route-progress';
import { buildCommandItems, filterCommandItems, type CommandItem } from './command-items';

const RECENT_KEY = 'rc.command.recent';
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures; recents are a convenience.
  }
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useShell();
  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogPrimitive.Portal>
        <DialogOverlay className="bg-[#1d2025]/35" />
        <DialogPrimitive.Content
          aria-label="Command palette"
          className="rc-pop fixed left-1/2 top-[12vh] z-50 flex max-h-[min(560px,76vh)] w-[calc(100%-1.5rem)] max-w-[600px] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[0_24px_64px_rgba(29,32,37,0.28)] focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Search or jump to</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Type to search pages, websites, buckets and actions. Use the arrow keys to move and Enter to open.
          </DialogPrimitive.Description>
          {paletteOpen && <PaletteBody onClose={() => setPaletteOpen(false)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { openShortcuts } = useShell();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  const { data: me } = useMe();
  const zonesQuery = useZones();
  const bucketsQuery = useBuckets();
  const zones = zonesQuery.data?.zones;
  const buckets = bucketsQuery.data?.buckets;
  const zoneId = zoneIdFromPath(pathname);
  const currentZone = zoneId ? zones?.find((z) => z.id === zoneId) ?? null : null;

  const all = React.useMemo(
    () => buildCommandItems({ role: me?.role, zones, buckets, zone: currentZone }),
    [me?.role, zones, buckets, currentZone],
  );

  const [recentIds] = React.useState(readRecent);
  const results = React.useMemo(() => {
    const filtered = filterCommandItems(all, query);
    if (query.trim()) return filtered;
    const byId = new Map(all.map((i) => [i.id, i]));
    const recent = recentIds
      .map((id) => byId.get(id))
      .filter((i): i is CommandItem => !!i)
      .map((i) => ({ ...i, id: `recent:${i.id}`, group: 'Recent' as const }));
    return [...recent, ...filtered];
  }, [all, query, recentIds]);

  React.useEffect(() => setActive(0), [query]);

  // Keep the highlighted option visible.
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function select(item: CommandItem) {
    pushRecent(item.id.replace(/^recent:/, ''));
    onClose();
    if (item.action === 'shortcuts') {
      openShortcuts();
      return;
    }
    if (item.href) {
      startRouteProgress(item.href);
      router.push(item.href);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault();
      setActive(results.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[active];
      if (item) select(item);
    }
  }

  const liveLoading = query.trim() !== '' && (zonesQuery.isLoading || bucketsQuery.isLoading);
  const optionId = (i: number) => `${listId}-opt-${i}`;

  let lastGroup: string | null = null;
  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? optionId(active) : undefined}
          aria-label="Search or jump to"
          placeholder="Search or jump to…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
        {liveLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading results" />}
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground sm:block">Esc</kbd>
      </div>

      <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
        {results.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            {liveLoading ? 'Searching…' : (
              <>
                No results for <span className="font-semibold text-foreground">“{query}”</span>
              </>
            )}
          </div>
        ) : (
          results.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.group === 'Recent' ? Clock : item.icon;
            const selected = i === active;
            return (
              <React.Fragment key={item.id}>
                {header && (
                  <div role="presentation" className="px-2.5 pb-1 pt-2.5 text-xs font-semibold text-muted-foreground first:pt-1">
                    {header}
                  </div>
                )}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={selected}
                  data-index={i}
                  onMouseMove={() => active !== i && setActive(i)}
                  onClick={() => select(item)}
                  className={cn(
                    'relative flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px]',
                    selected ? 'bg-primary-soft text-foreground' : 'text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                      selected ? 'border-primary/20 bg-background text-primary' : 'border-border bg-muted text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate font-medium">{item.label}</span>
                    {item.sublabel && <span className="truncate text-xs text-muted-foreground">{item.sublabel}</span>}
                  </span>
                  {selected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>

      <div className="hidden items-center gap-4 border-t border-border bg-muted px-4 py-2 text-[11px] text-muted-foreground sm:flex">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> to open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="min-w-[18px] rounded border border-border bg-background px-1 text-center font-sans text-[11px] leading-[16px]">{children}</kbd>;
}
