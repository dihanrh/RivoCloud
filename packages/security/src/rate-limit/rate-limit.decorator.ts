import { SetMetadata } from '@nestjs/common';
import type { RateLimitPolicy } from './policies.js';

export const RATE_LIMIT_KEY = 'rateLimits';
export const RateLimit = (...policies: RateLimitPolicy[]) => SetMetadata(RATE_LIMIT_KEY, policies);
