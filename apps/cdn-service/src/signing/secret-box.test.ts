import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, generateSigningSecret } from './secret-box.js';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('secret-box', () => {
  it('generates a 32-byte hex secret, different every time', () => {
    const first = generateSigningSecret();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSigningSecret()).not.toBe(first);
  });

  it('round-trips a secret and never stores the plaintext', () => {
    const stored = encryptSecret('super-secret', KEY);
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('super-secret');
    expect(decryptSecret(stored, KEY)).toBe('super-secret');
  });

  it('uses a fresh IV for every encryption', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('rejects a value decrypted with the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('super-secret', KEY), OTHER_KEY)).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const [version, iv, tag, ciphertext] = encryptSecret('super-secret', KEY).split(':');
    const flipped = Buffer.from(ciphertext!, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptSecret([version, iv, tag, flipped.toString('base64')].join(':'), KEY)).toThrow();
  });

  it('rejects an unknown format version', () => {
    expect(() => decryptSecret('v9:a:b:c', KEY)).toThrow(/format/);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => encryptSecret('x', 'abcd')).toThrow(/32 bytes/);
  });
});
