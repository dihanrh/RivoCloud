export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}
