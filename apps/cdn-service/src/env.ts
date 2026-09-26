import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@rivocloud/config';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3003),
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_API_SECRET: z.string().min(16),
  CDN_ROOT_DOMAIN: z.string().min(1).toLowerCase().default('cdn.rivocloud.dev'),
  EDGE_PROXY_URL: z.string().url().default('http://host.docker.internal:8888'),
  EDGE_HOSTNAME: z.string().min(1).toLowerCase().default('edge.rivocloud.dev'),
  SCHEDULER_SERVICE_URL: z.string().url().default('http://localhost:3005'),
  // AES-256-GCM key for pull_zones.signing_secret (32 bytes as 64 hex chars).
  ZONE_SECRET_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)'),
  // Scheme for signed URLs this service builds; local dev serves zones over plain http.
  CDN_URL_SCHEME: z.enum(['http', 'https']).default('https'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return validateEnv(envSchema, env);
}
