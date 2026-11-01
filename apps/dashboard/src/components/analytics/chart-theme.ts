import { AlertTriangle, CheckCircle2, CornerDownRight, XOctagon, type LucideIcon } from 'lucide-react';

// Chart colors are literal hex because SVG attributes cannot read CSS variables in every browser.
// Every multi-color set below was run through the data-viz palette validator against the white
// chart surface; keep the order when editing, it is part of what makes the sets distinguishable.
export const CHART_COLORS = {
  /** The single-series color: the brand action pink. */
  primary: '#d6246a',
  /** Hairline gridlines, one shade off the surface. */
  grid: '#eef0f3',
  /** Axis baseline. */
  baseline: '#d9dce1',
  /** Tick labels (muted ink). */
  axis: '#7b838f',
  /** Crosshair while hovering a time series. */
  cursor: '#b8bec8',
  /** Empty part of a meter or share bar. */
  track: '#f1f2f5',
} as const;

/**
 * p50 / p95 / p99 are ordered steps of one measure, so they share one hue, light to dark
 * (validated as an ordinal ramp: monotone lightness, light end above 2:1 on white).
 */
export const LATENCY_SERIES = [
  { key: 'p50', label: 'p50', color: '#ec6e9c' },
  { key: 'p95', label: 'p95', color: '#d6246a' },
  { key: 'p99', label: 'p99', color: '#8e1546' },
] as const;

export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

/**
 * HTTP status classes use the reserved status colors, never series colors, and always ship with
 * an icon and a label (amber is below 3:1 on white). Adjacent pairs in this order pass the CVD
 * check; red and green are never placed next to each other.
 */
export const STATUS_CLASSES: { key: StatusClass; label: string; color: string; icon: LucideIcon }[] = [
  { key: '2xx', label: 'Success', color: '#0ca30c', icon: CheckCircle2 },
  { key: '3xx', label: 'Redirect', color: '#2a78d6', icon: CornerDownRight },
  { key: '4xx', label: 'Client error', color: '#eda100', icon: AlertTriangle },
  { key: '5xx', label: 'Server error', color: '#d03b3b', icon: XOctagon },
];

export function statusClassOf(statusCode: number): StatusClass | null {
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return null;
}

/**
 * Cache status is told as one number (the hit ratio): HIT is emphasized in the brand color and
 * everything else recedes into grays.
 */
export const CACHE_STATUS_COLORS: Record<string, string> = {
  HIT: CHART_COLORS.primary,
  MISS: '#8a919c',
  EXPIRED: '#aab0b9',
  BYPASS: '#c9cdd4',
};
export const CACHE_OTHER_COLOR = '#dfe2e6';

// Series are drawn without Recharts' draw-in animation. That animation starts every series empty
// (lines stroke-dashed to zero length, areas clipped to zero width, pies at zero angle) and replays
// on every refetch, filter change and container resize, so a chart caught at the wrong moment shows
// bare axes even though its data has loaded.
export const SERIES_ANIMATION = { isAnimationActive: false } as const;

export const AXIS_TICK = { fontSize: 11.5, fill: CHART_COLORS.axis } as const;

/** Shared X axis props for time series. */
export const TIME_AXIS = {
  dataKey: 'bucket',
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: { stroke: CHART_COLORS.baseline },
  minTickGap: 56,
  tickMargin: 8,
} as const;

/** Shared Y axis props: no axis line, few ticks, labels only. */
export const VALUE_AXIS = {
  tick: AXIS_TICK,
  tickLine: false,
  axisLine: false,
  tickCount: 5,
  tickMargin: 4,
} as const;

export const HOVER_CURSOR = { stroke: CHART_COLORS.cursor, strokeWidth: 1 } as const;

/** The dot shown on a line under the crosshair: 2px surface ring so it separates from the line. */
export function activeDot(color: string) {
  return { r: 4, fill: color, stroke: '#ffffff', strokeWidth: 2 };
}

export function formatBucketTime(value: number | string): string {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Axis tick formatter sized to the visible span: hours for a day or less, dates beyond that.
 * (Tooltips keep the full date and time.)
 */
export function bucketTickFormatter(series: { bucket: number }[]): (value: number) => string {
  const first = series[0]?.bucket ?? 0;
  const last = series[series.length - 1]?.bucket ?? 0;
  const multiDay = last - first > 36 * 60 * 60 * 1000;
  return (value) =>
    multiDay
      ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
