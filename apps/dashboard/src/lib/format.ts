/**
 * Display formatting for the console. Use these everywhere instead of ad-hoc
 * toLocaleString / toFixed calls so numbers, sizes and times read the same on
 * every page. All helpers return '—' for null/undefined/NaN input.
 *
 *   formatBytes(1536)               → "1.5 KB"
 *   formatNumber(1234567)           → "1,234,567"
 *   formatCompact(1234567)          → "1.2M"
 *   formatPercent(0.4567)           → "45.7%"   (ratio in, 0..1)
 *   formatRelativeTime(date, now?)  → "3 min ago" / "in 2 days" / "just now"
 *   formatDateTime(date)            → "Oct 31, 2026, 2:05 PM"
 *   formatDate(date)                → "Oct 31, 2026"
 *   formatDuration(1500)            → "1.5 s"   (milliseconds in)
 *
 * For a relative time with the absolute time on hover, render
 * `<RelativeTime value={…} />` from `@/components/ui/relative-time`.
 */

const EMPTY = '—';
const LOCALE = 'en-US';

type DateInput = Date | string | number | null | undefined;
type NumberInput = number | string | bigint | null | undefined;

function toNumber(value: NumberInput): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** Binary (1024) byte sizes: "0 B", "512 B", "1.5 KB", "2.3 GB". Accepts the API's string sizes. */
export function formatBytes(value: NumberInput, fractionDigits = 1): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  let size = Math.abs(n);
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const sign = n < 0 ? '-' : '';
  if (unit === 0) return `${sign}${size} B`;
  return `${sign}${size.toFixed(fractionDigits)} ${BYTE_UNITS[unit]}`;
}

/** Grouped integer/decimal: 1234567 → "1,234,567". */
export function formatNumber(value: NumberInput, maximumFractionDigits = 0): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(n);
}

/** Compact: 950 → "950", 1200 → "1.2K", 3400000 → "3.4M". */
export function formatCompact(value: NumberInput): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/**
 * Percentage from a ratio: 0.4567 → "45.7%". Pass `{ fromPercent: true }`
 * when the value is already 0..100.
 */
export function formatPercent(
  value: NumberInput,
  { fractionDigits = 1, fromPercent = false }: { fractionDigits?: number; fromPercent?: boolean } = {},
): string {
  const n = toNumber(value);
  if (n === null) return EMPTY;
  const pct = fromPercent ? n : n * 100;
  // Drop a trailing ".0" so 100% and 0% read cleanly.
  const fixed = pct.toFixed(fractionDigits);
  return `${fixed.replace(/\.0+$/, '')}%`;
}

/** Milliseconds → "850 ms", "1.5 s", "2 min 5 s", "1 h 3 min". */
export function formatDuration(ms: NumberInput): string {
  const n = toNumber(ms);
  if (n === null) return EMPTY;
  if (n < 1000) return `${Math.round(n)} ms`;
  const s = n / 1000;
  if (s < 60) return `${Number(s.toFixed(1))} s`;
  const totalSec = Math.round(s);
  const m = Math.floor(totalSec / 60);
  if (m < 60) return totalSec % 60 ? `${m} min ${totalSec % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** "Oct 31, 2026, 2:05 PM". */
export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** "Oct 31, 2026". */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(d);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Short relative time: "just now", "3 min ago", "2 h ago", "yesterday",
 * "5 days ago", and beyond 30 days the absolute date ("Sep 12, 2026").
 * Future times read "in 3 min". `now` is injectable for tests.
 */
export function formatRelativeTime(value: DateInput, now: Date | number = Date.now()): string {
  const d = toDate(value);
  if (!d) return EMPTY;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const diffSec = Math.round((nowMs - d.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const future = diffSec < 0;
  const wrap = (s: string) => (future ? `in ${s}` : `${s} ago`);

  if (abs < 45) return 'just now';
  if (abs < HOUR) return wrap(`${Math.max(1, Math.round(abs / MINUTE))} min`);
  if (abs < DAY) return wrap(`${Math.round(abs / HOUR)} h`);
  const days = Math.round(abs / DAY);
  if (days === 1) return future ? 'tomorrow' : 'yesterday';
  if (days <= 30) return wrap(`${days} days`);
  return formatDate(d);
}
