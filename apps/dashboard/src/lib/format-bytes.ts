const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(size: string | null): string {
  if (size === null) return '—';

  let value = BigInt(size);
  let unitIndex = 0;
  let display = Number(value);

  while (value >= 1024n && unitIndex < UNITS.length - 1) {
    value /= 1024n;
    display /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${display} ${UNITS[unitIndex]}` : `${display.toFixed(1)} ${UNITS[unitIndex]}`;
}
