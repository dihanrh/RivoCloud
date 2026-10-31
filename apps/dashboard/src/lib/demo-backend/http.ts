/** A mock backend response: what the real service would have sent. */
export interface DemoResponse {
  status: number;
  body: unknown;
}

const ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

/**
 * Thrown by mock handlers; serialized exactly like a NestJS HttpException:
 * `{ statusCode, message, error }` (message is an array for validation errors).
 */
export class DemoHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string | string[],
  ) {
    super(Array.isArray(detail) ? detail.join('; ') : detail);
    this.name = 'DemoHttpError';
  }

  toResponse(): DemoResponse {
    return {
      status: this.status,
      body: { statusCode: this.status, message: this.detail, error: ERROR_NAMES[this.status] ?? 'Error' },
    };
  }
}

export const badRequest = (message: string | string[]) => new DemoHttpError(400, message);
export const unauthorized = (message = 'Unauthorized') => new DemoHttpError(401, message);
export const forbidden = (message: string) => new DemoHttpError(403, message);
export const notFound = (message: string) => new DemoHttpError(404, message);
export const conflict = (message: string) => new DemoHttpError(409, message);

/** Throws a 400 with every collected validation message, like Nest's ValidationPipe. */
export function assertValid(errors: (string | false | null | undefined)[]): void {
  const messages = errors.filter((e): e is string => typeof e === 'string');
  if (messages.length > 0) throw badRequest(messages);
}

/** Marks a non-default success status (e.g. 202 for cache purges). */
export function withStatus(status: number, body: unknown): DemoResponse & { __demoResponse: true } {
  return { status, body, __demoResponse: true };
}

export function isDemoResponse(value: unknown): value is DemoResponse {
  return typeof value === 'object' && value !== null && (value as { __demoResponse?: boolean }).__demoResponse === true;
}
