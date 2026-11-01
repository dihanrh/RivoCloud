'use client';

import { useAnalyticsCache } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompact, formatPercent } from '@/lib/format';
import { ChartEmpty, ChartError } from './chart-states';
import { CACHE_OTHER_COLOR, CACHE_STATUS_COLORS } from './chart-theme';
import { SegmentBar } from './segment-bar';

const DESCRIPTIONS: Record<string, string> = {
  HIT: 'Served from the edge cache',
  MISS: 'Fetched from your origin',
  EXPIRED: 'Revalidated with your origin',
  BYPASS: 'Not cacheable, sent to origin',
};

/**
 * The cache hit ratio as the headline number, then how every request was answered. HIT is the
 * story, so it alone carries the brand color; the other statuses recede into grays.
 */
export function CacheRatioGauge({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading, error } = useAnalyticsCache(params);
  if (isLoading)
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Loading chart">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  if (error) return <ChartError className="h-[300px]" />;
  const rows = [...(data?.breakdown ?? [])].sort((a, b) => b.requests - a.requests);
  if (rows.length === 0) return <ChartEmpty className="h-[300px]" />;
  const total = rows.reduce((sum, b) => sum + b.requests, 0);
  const segments = rows.map((b) => ({
    key: b.cacheStatus,
    label: b.cacheStatus,
    value: b.requests,
    color: CACHE_STATUS_COLORS[b.cacheStatus] ?? CACHE_OTHER_COLOR,
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[40px] font-semibold leading-none tracking-tight">{formatPercent(data?.hitRatio ?? 0)}</p>
        <p className="mt-2 text-xs text-muted-foreground">of requests never reached your origin</p>
      </div>
      <SegmentBar segments={segments} label="Requests by cache status" />
      <ul className="flex flex-col divide-y divide-border" aria-label="Requests by cache status">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-3 py-2.5 first:pt-0">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{s.label}</p>
              {DESCRIPTIONS[s.key] && <p className="truncate text-xs text-muted-foreground">{DESCRIPTIONS[s.key]}</p>}
            </div>
            <div className="text-right">
              <p className="text-[13px] font-medium tabular-nums">{formatCompact(s.value)}</p>
              <p className="text-xs tabular-nums text-muted-foreground">{formatPercent(total ? s.value / total : 0)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
