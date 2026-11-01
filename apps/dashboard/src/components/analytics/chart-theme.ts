// Chart colors mirror the console tokens in globals.css (SVG attributes need literal values).
export const CHART_COLORS = {
  primary: '#d6246a',
  orange: '#f7931e',
  purple: '#5b2a8c',
  success: '#1e7d3a',
  destructive: '#c4291c',
  grid: '#e6e8ec',
  axis: '#5e6670',
  track: '#fde8f0',
} as const;

// Series are drawn without Recharts' draw-in animation. That animation starts every series empty
// (lines stroke-dashed to zero length, areas clipped to zero width, pies at zero angle) and replays
// on every refetch, filter change and container resize, so a chart caught at the wrong moment shows
// bare axes even though its data has loaded.
export const SERIES_ANIMATION = { isAnimationActive: false } as const;

export const AXIS_TICK = { fontSize: 12, fill: CHART_COLORS.axis } as const;

export const TOOLTIP_STYLE = {
  contentStyle: { fontSize: 12, borderRadius: 6, border: '1px solid #d9dce1', boxShadow: 'none' },
  labelStyle: { color: '#1d2025', fontWeight: 600 },
} as const;

export function formatBucketTime(value: number | string): string {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
