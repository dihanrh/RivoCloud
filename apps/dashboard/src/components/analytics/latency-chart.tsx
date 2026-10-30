'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAnalyticsLatency } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AXIS_TICK, CHART_COLORS, TOOLTIP_STYLE, formatBucketTime } from './chart-theme';

export function LatencyChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsLatency(params);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data?.series ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickFormatter={formatBucketTime}
            minTickGap={48}
          />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `${v} ms`} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={formatBucketTime} formatter={(v: number) => `${v} ms`} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="p50" name="p50" stroke={CHART_COLORS.primary} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="p95" name="p95" stroke={CHART_COLORS.orange} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="p99" name="p99" stroke={CHART_COLORS.purple} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
