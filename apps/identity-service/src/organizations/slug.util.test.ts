import { describe, expect, it } from 'vitest';
import { slugify } from './slug.util.js';

describe('slugify', () => {
  it('lowercases and hyphenates a name', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('strips characters outside [a-z0-9-]', () => {
    expect(slugify("Bob's Widgets, LLC!")).toBe('bobs-widgets-llc');
  });

  it('collapses repeated separators', () => {
    expect(slugify('  Too   Many   Spaces  ')).toBe('too-many-spaces');
  });
});
