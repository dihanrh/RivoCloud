import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/http';
import { shouldRetryQuery } from './query-provider';

describe('shouldRetryQuery', () => {
  it('does not retry a 429', () => {
    expect(shouldRetryQuery(0, new ApiError(429, { message: 'Too many requests' }))).toBe(false);
  });

  it('does not retry other client errors', () => {
    expect(shouldRetryQuery(0, new ApiError(403, null))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(404, null))).toBe(false);
  });

  it('retries a server error once', () => {
    expect(shouldRetryQuery(0, new ApiError(503, null))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(503, null))).toBe(false);
  });

  it('retries a network error once', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(false);
  });
});
