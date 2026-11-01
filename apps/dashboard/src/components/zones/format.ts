const UNITS: [number, string][] = [
  [86_400, 'day'],
  [3_600, 'hour'],
  [60, 'minute'],
  [1, 'second'],
];

/** Human-readable cache lifetime, e.g. 3600 -> "1 hour". */
export function formatTtl(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'Website default';
  if (seconds === 0) return '0 seconds';
  for (const [size, unit] of UNITS) {
    if (seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${unit}${n === 1 ? '' : 's'}`;
    }
  }
  return `${seconds} seconds`;
}

export const ORIGIN_PROTOCOL_LABEL: Record<string, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  match: 'Match visitor',
};

/** Split a textarea into trimmed, non-empty, de-duplicated lines. */
export function splitLines(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
}
