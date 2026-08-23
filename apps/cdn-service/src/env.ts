import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@rivocloud/config';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3003),
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_API_SECRET: z.string().min(16),
  CDN_ROOT_DOMAIN: z.string().min(1).toLowerCase().default('cdn.rivocloud.dev'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return validateEnv(envSchema, env);
}
