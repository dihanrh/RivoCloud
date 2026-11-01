'use client';

import { formatBucketTime } from './chart-theme';

interface TooltipRow {
  key: string;
  label: string;
  color: string;
  value: string;
}

/**
 * The hover card for every time series: the bucket time, then one row per series with a color
 * swatch, the series name in secondary ink and the value in primary ink.
 *
 *   <Tooltip content={<ChartTooltip rows={(point) => [...]} />} />
 */
export function ChartTooltip<T extends { bucket: number }>({
  active,
  payload,
  rows,
}: {
  active?: boolean;
  payload?: { payload: T }[];
  rows: (point: T) => TooltipRow[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="min-w-44 rounded-lg border border-border bg-background/95 px-3 py-2.5 shadow-[0_8px_24px_-8px_rgba(29,32,37,0.25)] backdrop-blur-sm">
      <p className="text-[11.5px] font-medium text-muted-foreground">{formatBucketTime(point.bucket)}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {rows(point).map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: row.color }} aria-hidden />
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto pl-4 font-semibold tabular-nums text-foreground">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
