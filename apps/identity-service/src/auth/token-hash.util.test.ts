import { describe, expect, it } from 'vitest';
import { generateRawToken } from './token-hash.util.js';

describe('generateRawToken', () => {
  it('produces a raw token whose sha256 hash matches the returned hash', () => {
    const { raw, hash } = generateRawToken();
    expect(raw).toHaveLength(64); // 32 bytes as hex
    expect(hash).toHaveLength(64); // sha256 digest as hex
    expect(hash).not.toBe(raw);
  });

  it('produces different tokens on each call', () => {
    const first = generateRawToken();
    const second = generateRawToken();
    expect(first.raw).not.toBe(second.raw);
  });
});
