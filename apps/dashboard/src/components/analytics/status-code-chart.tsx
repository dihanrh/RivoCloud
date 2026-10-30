'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAnalyticsStatusCodes } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { CHART_COLORS, SERIES_ANIMATION, TOOLTIP_STYLE } from './chart-theme';

// Color by status class so a glance shows healthy vs failing traffic.
function colorFor(statusCode: number): string {
  if (statusCode >= 500) return CHART_COLORS.destructive;
  if (statusCode >= 400) return CHART_COLORS.orange;
  if (statusCode >= 300) return CHART_COLORS.purple;
  if (statusCode >= 200) return CHART_COLORS.success;
  return CHART_COLORS.axis;
}

export function StatusCodeChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsStatusCodes(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const breakdown = data?.breakdown ?? [];
  return (
    <div className="flex h-48 w-full items-center gap-4">
      <div className="h-full min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={breakdown} dataKey="requests" nameKey="statusCode" innerRadius={44} outerRadius={72} stroke="#ffffff" {...SERIES_ANIMATION}>
              {breakdown.map((entry) => (
                <Cell key={entry.statusCode} fill={colorFor(entry.statusCode)} />
              ))}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-1 text-[13px]">
        {breakdown.map((entry) => (
          <li key={entry.statusCode} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: colorFor(entry.statusCode) }} aria-hidden />
            <span className="tabular-nums">{entry.statusCode}</span>
            <span className="tabular-nums text-muted-foreground">{entry.requests.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
