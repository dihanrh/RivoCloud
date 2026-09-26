'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAnalyticsLatency } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function LatencyChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsLatency(params);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data?.series ?? []}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tickFormatter={(v) => new Date(v).toLocaleString()} minTickGap={40} />
          <YAxis />
          <Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} />
          <Line type="monotone" dataKey="p50" stroke="#22c55e" dot={false} />
          <Line type="monotone" dataKey="p95" stroke="#f59e0b" dot={false} />
          <Line type="monotone" dataKey="p99" stroke="#ef4444" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
