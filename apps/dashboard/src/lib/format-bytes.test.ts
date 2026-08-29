import { describe, expect, it } from 'vitest';
import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it('returns a placeholder for null (object still pending)', () => {
    expect(formatBytes(null)).toBe('—');
  });

  it('formats small byte counts as-is', () => {
    expect(formatBytes('512')).toBe('512 B');
  });

  it('formats kilobytes, megabytes, and gigabytes with one decimal', () => {
    expect(formatBytes('2048')).toBe('2.0 KB');
    expect(formatBytes('5242880')).toBe('5.0 MB');
    expect(formatBytes('3221225472')).toBe('3.0 GB');
  });
});
