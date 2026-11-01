'use client';

import { useAnalyticsStatusCodes } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { formatCompact, formatNumber, formatPercent } from '@/lib/format';
import { ChartEmpty, ChartError, ChartSkeleton } from './chart-states';
import { STATUS_CLASSES, statusClassOf } from './chart-theme';
import { SegmentBar } from './segment-bar';

const OTHER_COLOR = '#c9cdd4';

/**
 * Responses by HTTP status class (2xx-5xx) as a part-to-whole bar, each class with its reserved
 * status color, an icon and a label, followed by the most frequent individual codes.
 */
export function StatusCodeChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading, error } = useAnalyticsStatusCodes(params);
  if (isLoading) return <ChartSkeleton className="h-[300px]" />;
  if (error) return <ChartError className="h-[300px]" />;
  const breakdown = [...(data?.breakdown ?? [])].sort((a, b) => b.requests - a.requests);
  if (breakdown.length === 0) return <ChartEmpty className="h-[300px]" />;

  const total = breakdown.reduce((sum, e) => sum + e.requests, 0);
  const byClass = new Map<string, number>();
  for (const e of breakdown) {
    const cls = statusClassOf(e.statusCode) ?? 'other';
    byClass.set(cls, (byClass.get(cls) ?? 0) + e.requests);
  }
  const classes = STATUS_CLASSES.map((c) => ({ ...c, value: byClass.get(c.key) ?? 0 }));
  const other = byClass.get('other') ?? 0;
  const topCodes = breakdown.slice(0, 5);
  const share = (v: number) => formatPercent(total ? v / total : 0);

  return (
    <div className="flex flex-col gap-5">
      <SegmentBar
        label="Responses by status class"
        segments={[
          ...classes.map((c) => ({ key: c.key, label: `${c.key} ${c.label}`, value: c.value, color: c.color })),
          { key: 'other', label: 'Other', value: other, color: OTHER_COLOR },
        ]}
      />
      <ul className="grid grid-cols-2 gap-x-4 gap-y-3" aria-label="Responses by status class">
        {classes.map(({ key, label, color, icon: Icon, value }) => (
          <li key={key} className="flex items-start gap-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-medium">
                {key} <span className="font-normal text-muted-foreground">{label}</span>
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{share(value)}</span> · {formatCompact(value)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Top codes</p>
        <ul className="flex flex-col divide-y divide-border">
          {topCodes.map((e) => {
            const cls = STATUS_CLASSES.find((c) => c.key === statusClassOf(e.statusCode));
            return (
              <li key={e.statusCode} className="flex items-center gap-2.5 py-1.5 text-[13px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: cls?.color ?? OTHER_COLOR }} aria-hidden />
                <span className="font-mono font-medium">{e.statusCode}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{formatNumber(e.requests)}</span>
                <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{share(e.requests)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
