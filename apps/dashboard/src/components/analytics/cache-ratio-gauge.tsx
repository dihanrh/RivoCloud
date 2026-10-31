'use client';

import { RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { useAnalyticsCache } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompact, formatPercent } from '@/lib/format';
import { ChartError } from './chart-states';
import { CHART_COLORS, SERIES_ANIMATION } from './chart-theme';

export function CacheRatioGauge({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading, error } = useAnalyticsCache(params);
  if (isLoading)
    return (
      <div className="flex h-48 items-center justify-center" role="status" aria-label="Loading chart">
        <Skeleton className="h-40 w-40 rounded-full" />
      </div>
    );
  if (error) return <ChartError className="h-48" />;
  const pct = Math.round((data?.hitRatio ?? 0) * 100);
  const breakdown = [...(data?.breakdown ?? [])].sort((a, b) => b.requests - a.requests).slice(0, 5);
  const total = breakdown.reduce((sum, b) => sum + b.requests, 0);

  return (
    <div className="flex h-48 w-full items-center gap-4">
      <div className="relative h-full min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="72%"
            outerRadius="100%"
            data={[{ name: 'hitRatio', value: pct, fill: CHART_COLORS.primary }]}
            startAngle={90}
            endAngle={-270}
          >
            <RadialBar dataKey="value" background={{ fill: CHART_COLORS.track }} cornerRadius={8} {...SERIES_ANIMATION} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-2xl font-semibold tabular-nums">{pct}%</p>
          <p className="text-xs text-muted-foreground">Cache hit ratio</p>
        </div>
      </div>
      {breakdown.length > 0 && (
        <ul className="flex min-w-32 flex-col gap-1.5 text-[13px]" aria-label="Requests by cache status">
          {breakdown.map((b) => (
            <li key={b.cacheStatus} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="font-medium">{b.cacheStatus}</span>
              <span className="text-right tabular-nums text-muted-foreground">
                {formatCompact(b.requests)} <span className="text-xs">({formatPercent(total ? b.requests / total : 0, { fractionDigits: 0 })})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
