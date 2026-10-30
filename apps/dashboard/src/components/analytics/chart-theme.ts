// Chart colors mirror the console tokens in globals.css (SVG attributes need literal values).
export const CHART_COLORS = {
  primary: '#0051c3',
  orange: '#f7931e',
  purple: '#5b2a8c',
  success: '#1e7d3a',
  destructive: '#c4291c',
  grid: '#e6e8ec',
  axis: '#5e6670',
  track: '#e8f0fc',
} as const;

export const AXIS_TICK = { fontSize: 12, fill: CHART_COLORS.axis } as const;

export const TOOLTIP_STYLE = {
  contentStyle: { fontSize: 12, borderRadius: 6, border: '1px solid #d9dce1', boxShadow: 'none' },
  labelStyle: { color: '#1d2025', fontWeight: 600 },
} as const;

export function formatBucketTime(value: number | string): string {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
