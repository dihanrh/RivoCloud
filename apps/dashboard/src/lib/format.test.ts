import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCompact,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from './format';

describe('format helpers', () => {
  it('formats bytes in binary units and accepts strings', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes('1073741824')).toBe('1.0 GB');
    expect(formatBytes(null)).toBe('—');
  });

  it('formats grouped and compact numbers', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(12.345, 2)).toBe('12.35');
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1200)).toBe('1.2K');
    expect(formatCompact(3_400_000)).toBe('3.4M');
    expect(formatNumber(undefined)).toBe('—');
  });

  it('formats percentages from ratios or percents', () => {
    expect(formatPercent(0.4567)).toBe('45.7%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(87.25, { fromPercent: true, fractionDigits: 2 })).toBe('87.25%');
    expect(formatPercent(Number.NaN)).toBe('—');
  });

  it('formats durations', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
    expect(formatDuration(3_780_000)).toBe('1 h 3 min');
  });

  it('formats relative times against an injected now', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    expect(formatRelativeTime('2026-10-31T11:59:40Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-31T11:57:00Z', now)).toBe('3 min ago');
    expect(formatRelativeTime('2026-10-31T10:00:00Z', now)).toBe('2 h ago');
    expect(formatRelativeTime('2026-10-30T12:00:00Z', now)).toBe('yesterday');
    expect(formatRelativeTime('2026-10-26T12:00:00Z', now)).toBe('5 days ago');
    expect(formatRelativeTime('2026-10-31T12:03:00Z', now)).toBe('in 3 min');
    expect(formatRelativeTime('2026-08-01T12:00:00Z', now)).toBe(formatDate('2026-08-01T12:00:00Z'));
    expect(formatRelativeTime('not a date', now)).toBe('—');
  });

  it('formats absolute dates', () => {
    expect(formatDate('2026-10-31T12:00:00')).toBe('Oct 31, 2026');
    expect(formatDateTime('2026-10-31T14:05:00')).toMatch(/Oct 31, 2026.*2:05/);
  });
});
