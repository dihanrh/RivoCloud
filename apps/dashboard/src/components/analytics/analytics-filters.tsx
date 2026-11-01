'use client';

import { useRef } from 'react';
import { Globe } from 'lucide-react';
import { Select } from '@/components/ui/input';
import { useZones } from '@/hooks/use-zones';
import type { AnalyticsQueryParams } from '@/lib/types';
import { cn } from '@/lib/utils';

export const RANGE_PRESETS: Record<string, { label: string; short: string; ms: number }> = {
  '24h': { label: 'Last 24 hours', short: '24h', ms: 24 * 60 * 60 * 1000 },
  '7d': { label: 'Last 7 days', short: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  '30d': { label: 'Last 30 days', short: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
};

export type AnalyticsFilterState = AnalyticsQueryParams & { rangeKey: string };

/** Human label for the active range ("Last 7 days"). */
export function rangeLabel(rangeKey: string): string {
  return RANGE_PRESETS[rangeKey]?.label ?? 'Custom range';
}

/**
 * Website picker + range segmented control. Used by the account Analytics page and the
 * per-website analytics page (with `showZone={false}`).
 */
export function AnalyticsFilters({
  params,
  onChange,
  showZone = true,
}: {
  params: AnalyticsFilterState;
  onChange: (next: AnalyticsFilterState) => void;
  /** Hide the website selector when the page is already scoped to one website. */
  showZone?: boolean;
}) {
  const { data } = useZones();
  const keys = Object.keys(RANGE_PRESETS);
  const groupRef = useRef<HTMLDivElement>(null);

  function setRange(rangeKey: string) {
    if (rangeKey === params.rangeKey) return;
    const to = new Date();
    const from = new Date(to.getTime() - RANGE_PRESETS[rangeKey]!.ms);
    onChange({ ...params, rangeKey, from: from.toISOString(), to: to.toISOString() });
  }

  // Radio-group keyboard pattern: arrows move and select.
  function onKeyDown(event: React.KeyboardEvent) {
    const index = keys.indexOf(params.rangeKey);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % keys.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + keys.length) % keys.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = keys.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setRange(keys[next]!);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showZone && (
        <div className="relative">
          <Globe className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Select
            aria-label="Website"
            className="h-8 w-auto min-w-48 pl-8 text-[13px]"
            value={params.zoneId ?? ''}
            onChange={(e) => onChange({ ...params, zoneId: e.target.value || undefined })}
          >
            <option value="">All websites</option>
            {(data?.zones ?? []).map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label="Range"
        onKeyDown={onKeyDown}
        className="inline-flex h-8 items-center rounded-[var(--radius)] border border-border-strong bg-background p-0.5"
      >
        {keys.map((key) => {
          const active = key === params.rangeKey;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={RANGE_PRESETS[key]!.label}
              title={RANGE_PRESETS[key]!.label}
              tabIndex={active ? 0 : -1}
              onClick={() => setRange(key)}
              className={cn(
                'h-full rounded-[calc(var(--radius)-2px)] px-3 text-[13px] font-medium tabular-nums transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary motion-reduce:transition-none',
                active ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {RANGE_PRESETS[key]!.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}
