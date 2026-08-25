import { describe, expect, it } from 'vitest';
import { splitKeyAndVersion } from './object-key.util.js';

describe('splitKeyAndVersion', () => {
  it('splits on the last slash for a normal "key/versionId" MinIO object key', () => {
    expect(splitKeyAndVersion('assets/hero.jpg/11111111-1111-1111-1111-111111111111')).toEqual([
      'assets/hero.jpg',
      '11111111-1111-1111-1111-111111111111',
    ]);
  });

  it('returns the whole string as the key and an empty versionId for a key with no slash', () => {
    // Previously: rawMinioKey.slice(0, -1) silently dropped the last character
    // of the input (e.g. 'foo.txt' -> ['foo.tx', 'foo.txt']) instead of failing
    // cleanly. This must not corrupt the input.
    expect(splitKeyAndVersion('foo.txt')).toEqual(['foo.txt', '']);
  });
});
