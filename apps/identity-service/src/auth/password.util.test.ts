import { describe, expect, it } from 'vitest';
import { hashPassword, comparePassword } from './password.util.js';

describe('password.util', () => {
  it('hashes a password to a value different from the plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple', 4);
    expect(hash).not.toBe('correct horse battery staple');
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple', 4);
    await expect(comparePassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple', 4);
    await expect(comparePassword('wrong password', hash)).resolves.toBe(false);
  });
});
