'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAnalyticsBandwidth } from '@/hooks/use-analytics';
import { formatBytes } from '@/lib/format-bytes';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AXIS_TICK, CHART_COLORS, SERIES_ANIMATION, TOOLTIP_STYLE, formatBucketTime } from './chart-theme';

const bytesLabel = (v: number) => formatBytes(String(Math.round(v)));

export function BandwidthChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsBandwidth(params);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data?.series ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickFormatter={formatBucketTime}
            minTickGap={48}
          />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={64} tickFormatter={bytesLabel} />
          <Tooltip {...TOOLTIP_STYLE} labelFormatter={formatBucketTime} formatter={(v: number) => [bytesLabel(v), 'Bandwidth']} />
          <Area
            type="monotone"
            dataKey="bytesSent"
            stroke={CHART_COLORS.primary}
            strokeWidth={2}
            fill={CHART_COLORS.primary}
            fillOpacity={0.12}
            {...SERIES_ANIMATION}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
