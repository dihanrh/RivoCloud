'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAnalyticsStatusCodes } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

const COLORS = ['#22c55e', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6'];

export function StatusCodeChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsStatusCodes(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const breakdown = data?.breakdown ?? [];
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={breakdown} dataKey="requests" nameKey="statusCode" innerRadius={40} outerRadius={70}>
            {breakdown.map((entry, i) => (
              <Cell key={entry.statusCode} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
