import { ApiError } from '@/lib/http';

export const NETWORK_ERROR = "Can't reach RivoCloud right now. Check your connection and try again.";
export const RATE_LIMIT_ERROR = 'Too many attempts. Try again in a minute.';
export const INVALID_CREDENTIALS = 'Incorrect email or password.';
export const SERVER_ERROR = 'Something went wrong on our side. Try again in a moment.';

/**
 * A user-facing message for a failed auth request. Status codes are mapped to
 * our own copy instead of echoing backend text, which can be technical
 * (validation arrays, framework exception names).
 */
export function authErrorMessage(err: unknown, overrides: Partial<Record<number, string>> = {}): string {
  if (!(err instanceof ApiError)) return NETWORK_ERROR;
  const override = overrides[err.status];
  if (override) return override;
  if (err.status === 429) return RATE_LIMIT_ERROR;
  if (err.status === 502 || err.status === 503 || err.status === 504) return NETWORK_ERROR;
  if (err.status >= 500) return SERVER_ERROR;
  const message = (err.body as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.length > 0 && message.length < 160) return message;
  return 'Check the form and try again.';
}
