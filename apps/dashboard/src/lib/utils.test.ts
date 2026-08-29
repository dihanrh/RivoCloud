import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class names and drops falsy values', () => {
    expect(cn('a', false, undefined, 'b')).toBe('a b');
  });

  it('lets a later Tailwind class win over a conflicting earlier one', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
