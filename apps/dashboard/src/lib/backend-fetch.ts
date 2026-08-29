export class BackendError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Backend request failed with status ${status}`);
    this.name = 'BackendError';
  }
}

export async function backendFetch(
  baseUrl: string,
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<unknown> {
  const { accessToken, headers, ...rest } = init;
  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new BackendError(response.status, body);
  }
  return body;
}
