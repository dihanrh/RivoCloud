import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { baseEnvSchema, validateEnv } from './env.js';

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

  describe('baseEnvSchema security settings', () => {
    const required = {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      NATS_URL: 'nats://localhost:4222',
    } as NodeJS.ProcessEnv;

    it('defaults TRUST_PROXY and RATE_LIMIT_ENABLED', () => {
      const env = validateEnv(baseEnvSchema, required);
      expect(env.TRUST_PROXY).toBe('loopback, linklocal, uniquelocal');
      expect(env.RATE_LIMIT_ENABLED).toBe(true);
    });

    it('parses RATE_LIMIT_ENABLED=false', () => {
      const env = validateEnv(baseEnvSchema, { ...required, RATE_LIMIT_ENABLED: 'false' });
      expect(env.RATE_LIMIT_ENABLED).toBe(false);
    });
  });
});
