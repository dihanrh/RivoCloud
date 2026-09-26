'use client';

import { RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { useAnalyticsCache } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function CacheRatioGauge({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsCache(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const pct = Math.round((data?.hitRatio ?? 0) * 100);
  return (
    <div className="flex h-48 flex-col items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="70%"
          outerRadius="100%"
          data={[{ name: 'hitRatio', value: pct, fill: '#22c55e' }]}
          startAngle={90}
          endAngle={-270}
        >
          <RadialBar dataKey="value" background cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <p className="-mt-32 text-2xl font-semibold">{pct}%</p>
      <p className="mt-32 text-sm text-muted-foreground">Cache hit ratio</p>
    </div>
  );
}
