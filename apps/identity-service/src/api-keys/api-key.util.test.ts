import { describe, expect, it } from 'vitest';
import { generateApiKey } from './api-key.util.js';

describe('generateApiKey', () => {
  it('generates a live key with the rc_live_ prefix by default', () => {
    const { raw, prefix } = generateApiKey(false);
    expect(raw.startsWith('rc_live_')).toBe(true);
    expect(prefix).toBe(raw.slice(0, 12));
  });

  it('generates a test key with the rc_test_ prefix when testMode is true', () => {
    const { raw } = generateApiKey(true);
    expect(raw.startsWith('rc_test_')).toBe(true);
  });

  it('generates different keys on each call', () => {
    const first = generateApiKey(false);
    const second = generateApiKey(false);
    expect(first.raw).not.toBe(second.raw);
  });
});
