import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@rivocloud/config';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3002),
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_API_SECRET: z.string().min(16),
  MINIO_URL: z.string().url().default('http://localhost:9000'),
  MINIO_ROOT_USER: z.string().min(1).default('rivocloud'),
  MINIO_ROOT_PASSWORD: z.string().min(1),
  MINIO_WEBHOOK_AUTH_TOKEN: z.string().min(16),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return validateEnv(envSchema, env);
}
