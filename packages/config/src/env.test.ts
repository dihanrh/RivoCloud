import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('parses valid environment variables according to the schema', () => {
    const schema = z.object({ FOO: z.string() });
    const result = validateEnv(schema, { FOO: 'bar' } as NodeJS.ProcessEnv);
    expect(result.FOO).toBe('bar');
  });

  it('throws a descriptive error naming the missing key when validation fails', () => {
    const schema = z.object({ FOO: z.string() });
    expect(() => validateEnv(schema, {} as NodeJS.ProcessEnv)).toThrow(/FOO/);
  });

  it('applies defaults declared on the schema', () => {
    const schema = z.object({ NODE_ENV: z.enum(['development', 'test', 'production']).default('development') });
    const result = validateEnv(schema, {} as NodeJS.ProcessEnv);
    expect(result.NODE_ENV).toBe('development');
  });
});
