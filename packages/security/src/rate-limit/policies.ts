export type RateLimitKey = 'ip' | 'principal' | { param: string };

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowSeconds: number;
  key: RateLimitKey;
}

// EDD 8.3 rate limits.
export const RATE_LIMITS = {
  auth: { name: 'auth', limit: 10, windowSeconds: 60, key: 'ip' },
  forgotPassword: { name: 'forgot-password', limit: 5, windowSeconds: 3600, key: 'ip' },
  general: { name: 'general', limit: 1000, windowSeconds: 60, key: 'principal' },
  cacheInvalidation: { name: 'cache-invalidation', limit: 100, windowSeconds: 60, key: { param: 'zoneId' } },
  analytics: { name: 'analytics', limit: 60, windowSeconds: 60, key: 'principal' },
} as const satisfies Record<string, RateLimitPolicy>;

export const SECURITY_REDIS = Symbol('SECURITY_REDIS');
export const SECURITY_OPTIONS = Symbol('SECURITY_OPTIONS');

export const DEFAULT_LIMITER_TIMEOUT_MS = 250;

export interface SecurityOptions {
  rateLimitEnabled: boolean;
  /**
   * Upper bound on one limiter round-trip. A slower (or never-settling) call is treated
   * like a Redis error: the request is allowed (fail-open). Defaults to DEFAULT_LIMITER_TIMEOUT_MS.
   */
  limiterTimeoutMs?: number;
}
