'use client';

import { useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAnalyticsBandwidth } from '@/hooks/use-analytics';
import { formatBytes, formatCompact, formatNumber } from '@/lib/format';
import type { AnalyticsQueryParams } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ChartEmpty, ChartError, ChartSkeleton } from './chart-states';
import {
  CHART_COLORS,
  HOVER_CURSOR,
  SERIES_ANIMATION,
  TIME_AXIS,
  VALUE_AXIS,
  activeDot,
  bucketTickFormatter,
  formatBucketTime,
} from './chart-theme';
import { ChartTooltip } from './chart-tooltip';

type Point = { bucket: number; bytesSent: number; requests: number };

// Bandwidth and requests have different scales, so they are two views of one chart (never two
// y-axes on one plot).
const METRICS = {
  bytesSent: { label: 'Bandwidth', axis: (v: number) => formatBytes(Math.round(v)), value: (v: number) => formatBytes(Math.round(v)) },
  requests: { label: 'Requests', axis: (v: number) => formatCompact(v), value: (v: number) => formatNumber(v) },
} as const;
type Metric = keyof typeof METRICS;

/** Traffic over time: bandwidth or requests, with the range total and peak above the plot. */
export function BandwidthChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading, error } = useAnalyticsBandwidth(params);
  const [metric, setMetric] = useState<Metric>('bytesSent');
  const gradientId = useId().replace(/:/g, '');

  if (isLoading) return <ChartSkeleton className="h-[300px]" />;
  if (error) return <ChartError className="h-[300px]" />;
  const series: Point[] = data?.series ?? [];
  if (!series.length) return <ChartEmpty className="h-[300px]" />;

  const m = METRICS[metric];
  const total = series.reduce((sum, p) => sum + p[metric], 0);
  const peak = series.reduce((best, p) => (p[metric] > best[metric] ? p : best), series[0]!);
  const tick = bucketTickFormatter(series);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <dl className="flex gap-6">
          <div>
            <dt className="text-xs text-muted-foreground">Total</dt>
            <dd className="text-xl font-semibold tracking-tight">{m.value(total)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Peak</dt>
            <dd className="text-xl font-semibold tracking-tight">
              {m.value(peak[metric])}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{formatBucketTime(peak.bucket)}</span>
            </dd>
          </div>
        </dl>
        <MetricToggle value={metric} onChange={setMetric} />
      </div>
      <div className="h-[236px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.24} />
                <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis {...TIME_AXIS} tickFormatter={tick} />
            <YAxis {...VALUE_AXIS} width={60} tickFormatter={m.axis} />
            <Tooltip
              cursor={HOVER_CURSOR}
              content={
                <ChartTooltip<Point>
                  rows={(p) => [{ key: metric, label: m.label, color: CHART_COLORS.primary, value: m.value(p[metric]) }]}
                />
              }
            />
            <Area
              type="monotone"
              dataKey={metric}
              name={m.label}
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              activeDot={activeDot(CHART_COLORS.primary)}
              {...SERIES_ANIMATION}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MetricToggle({ value, onChange }: { value: Metric; onChange: (metric: Metric) => void }) {
  const keys = Object.keys(METRICS) as Metric[];
  return (
    <div role="radiogroup" aria-label="Metric" className="inline-flex h-8 items-center rounded-[var(--radius)] bg-muted p-0.5">
      {keys.map((key) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              const next = keys[(keys.indexOf(key) + 1) % keys.length]!;
              onChange(next);
              (event.currentTarget.parentElement?.querySelector(`[data-metric="${next}"]`) as HTMLButtonElement | null)?.focus();
            }}
            data-metric={key}
            className={cn(
              'h-full rounded-[calc(var(--radius)-2px)] px-3 text-[12.5px] font-medium transition-colors duration-150',
              active ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(29,32,37,0.12)]' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {METRICS[key].label}
          </button>
        );
      })}
    </div>
  );
}
