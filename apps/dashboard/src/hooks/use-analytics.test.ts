import { describe, expect, it } from 'vitest';
import { toSearchParams } from './use-analytics.js';

describe('toSearchParams', () => {
  it('returns an empty string for no params', () => {
    expect(toSearchParams({})).toBe('');
  });

  it('includes only the params that are set', () => {
    expect(toSearchParams({ zoneId: 'zone-1', granularity: 'day' })).toBe('?zoneId=zone-1&granularity=day');
  });

  it('includes from/to when both are set', () => {
    const qs = toSearchParams({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
    expect(qs).toBe('?from=2026-01-01T00%3A00%3A00Z&to=2026-01-02T00%3A00%3A00Z');
  });
});
