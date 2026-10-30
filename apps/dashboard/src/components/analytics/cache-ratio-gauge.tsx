'use client';

import { RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { useAnalyticsCache } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { CHART_COLORS } from './chart-theme';

export function CacheRatioGauge({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsCache(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const pct = Math.round((data?.hitRatio ?? 0) * 100);
  return (
    <div className="relative h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="72%"
          outerRadius="100%"
          data={[{ name: 'hitRatio', value: pct, fill: CHART_COLORS.primary }]}
          startAngle={90}
          endAngle={-270}
        >
          <RadialBar dataKey="value" background={{ fill: CHART_COLORS.track }} cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-2xl font-semibold tabular-nums">{pct}%</p>
        <p className="text-xs text-muted-foreground">Cache hit ratio</p>
      </div>
    </div>
  );
}
