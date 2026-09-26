import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@rivocloud/config';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3005),
  INTERNAL_API_SECRET: z.string().min(16),
  EDGE_HOSTNAME: z.string().min(1).toLowerCase().default('edge.rivocloud.dev'),
  DOMAIN_DNS_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  DOMAIN_SSL_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  CLICKHOUSE_URL: z.string().url(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return validateEnv(envSchema, env);
}
