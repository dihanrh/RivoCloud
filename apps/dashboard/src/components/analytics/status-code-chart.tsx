'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAnalyticsStatusCodes } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { formatNumber, formatPercent } from '@/lib/format';
import { ChartEmpty, ChartError, ChartSkeleton } from './chart-states';
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
  const { data, isLoading, error } = useAnalyticsStatusCodes(params);
  if (isLoading) return <ChartSkeleton className="h-48" />;
  if (error) return <ChartError className="h-48" />;
  const breakdown = [...(data?.breakdown ?? [])].sort((a, b) => b.requests - a.requests);
  if (breakdown.length === 0) return <ChartEmpty className="h-48" />;
  const total = breakdown.reduce((sum, e) => sum + e.requests, 0);
  // The legend lists the six largest codes; the rest are summed into "Other".
  const legend = breakdown.slice(0, 6);
  const otherRequests = breakdown.slice(6).reduce((sum, e) => sum + e.requests, 0);
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
      <ul className="flex min-w-40 flex-col gap-1.5 text-[13px]">
        {legend.map((entry) => (
          <li key={entry.statusCode} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: colorFor(entry.statusCode) }} aria-hidden />
            <span className="font-medium tabular-nums">{entry.statusCode}</span>
            <span className="text-right tabular-nums text-muted-foreground">{formatNumber(entry.requests)}</span>
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(total ? entry.requests / total : 0)}</span>
          </li>
        ))}
        {otherRequests > 0 && (
          <li className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-border-strong" aria-hidden />
            <span className="font-medium">Other</span>
            <span className="text-right tabular-nums">{formatNumber(otherRequests)}</span>
            <span className="w-12 text-right text-xs tabular-nums">{formatPercent(total ? otherRequests / total : 0)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
