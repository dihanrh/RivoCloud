import { z } from 'zod';

/**
 * RIVO_DEMO_BACKEND=mock swaps every backend call for the in-memory demo
 * backend in src/lib/demo-backend (see docs/deploy-vercel.md). It is a
 * server-only variable, read at request time.
 */
export function isDemoBackend(): boolean {
  return process.env.RIVO_DEMO_BACKEND === 'mock';
}

/** Placeholder base URLs used in mock mode; the demo backend routes on them. */
export const DEMO_SERVICE_URLS = {
  IDENTITY_SERVICE_URL: 'http://mock.identity',
  CDN_SERVICE_URL: 'http://mock.cdn',
  STORAGE_SERVICE_URL: 'http://mock.storage',
  ANALYTICS_SERVICE_URL: 'http://mock.analytics',
} as const;

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');

const envSchema = z.object({
  NODE_ENV: nodeEnv,
  IDENTITY_SERVICE_URL: z.string().url(),
  CDN_SERVICE_URL: z.string().url(),
  STORAGE_SERVICE_URL: z.string().url(),
  ANALYTICS_SERVICE_URL: z.string().url(),
});

// In mock mode the service URLs are optional; nothing is ever fetched from them.
const demoEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  IDENTITY_SERVICE_URL: z.string().url().default(DEMO_SERVICE_URLS.IDENTITY_SERVICE_URL),
  CDN_SERVICE_URL: z.string().url().default(DEMO_SERVICE_URLS.CDN_SERVICE_URL),
  STORAGE_SERVICE_URL: z.string().url().default(DEMO_SERVICE_URLS.STORAGE_SERVICE_URL),
  ANALYTICS_SERVICE_URL: z.string().url().default(DEMO_SERVICE_URLS.ANALYTICS_SERVICE_URL),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  const schema = isDemoBackend() ? demoEnvSchema : envSchema;
  // Treat empty strings (an unset variable in some dashboards) as missing.
  const source = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
