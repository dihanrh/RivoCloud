'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAnalyticsLatency } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { ChartEmpty, ChartError, ChartSkeleton } from './chart-states';
import {
  CHART_COLORS,
  HOVER_CURSOR,
  LATENCY_SERIES,
  SERIES_ANIMATION,
  TIME_AXIS,
  VALUE_AXIS,
  activeDot,
  bucketTickFormatter,
} from './chart-theme';
import { ChartTooltip } from './chart-tooltip';

type Point = { bucket: number; p50: number; p95: number; p99: number };

// Quantiles come back as raw floats (e.g. 224.40000000000003).
const msLabel = (v: number) => `${Math.round(v)} ms`;

/** p50 / p95 / p99 time to first byte. The legend doubles as a summary: each quantile's range average. */
export function LatencyChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading, error } = useAnalyticsLatency(params);
  if (isLoading) return <ChartSkeleton className="h-[300px]" />;
  if (error) return <ChartError className="h-[300px]" />;
  const series: Point[] = data?.series ?? [];
  if (!series.length) return <ChartEmpty className="h-[300px]" />;
  const average = (key: keyof Omit<Point, 'bucket'>) => series.reduce((sum, p) => sum + p[key], 0) / series.length;

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Average latency">
        {LATENCY_SERIES.map((s) => (
          <li key={s.key} className="flex flex-col">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-[3px] w-3.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label} average
            </span>
            <span className="text-xl font-semibold tracking-tight">{msLabel(average(s.key))}</span>
          </li>
        ))}
      </ul>
      <div className="h-[236px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis {...TIME_AXIS} tickFormatter={bucketTickFormatter(series)} />
            <YAxis {...VALUE_AXIS} width={56} tickFormatter={msLabel} />
            <Tooltip
              cursor={HOVER_CURSOR}
              content={
                <ChartTooltip<Point>
                  rows={(p) =>
                    // Slowest first, matching the stacking order of the lines.
                    [...LATENCY_SERIES].reverse().map((s) => ({ key: s.key, label: s.label, color: s.color, value: msLabel(p[s.key]) }))
                  }
                />
              }
            />
            {LATENCY_SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={activeDot(s.color)}
                {...SERIES_ANIMATION}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
