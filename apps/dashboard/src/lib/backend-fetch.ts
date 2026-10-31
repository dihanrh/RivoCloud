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

  // Read directly (not via ./env) so this stays independent of env parsing.
  if (process.env.RIVO_DEMO_BACKEND === 'mock') {
    // Demo deployments (RIVO_DEMO_BACKEND=mock) answer every backend call from
    // an in-memory store with the same response and error shapes. Loaded
    // lazily so normal deployments never pull it in.
    const { handleDemoRequest } = await import('./demo-backend');
    const result = await handleDemoRequest(baseUrl, path, {
      method: rest.method,
      body: typeof rest.body === 'string' ? rest.body : undefined,
      accessToken,
      headers: headers as Record<string, string> | undefined,
    });
    if (result.status >= 400) throw new BackendError(result.status, result.body);
    return result.body;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
    });
  } catch {
    // Network failure, DNS error, connection refused, aborted request, etc. — the
    // backend was unreachable rather than returning an error response. Surface it
    // as a BackendError (like any other backend failure) instead of letting the
    // raw fetch error (TypeError/AbortError) escape and become an opaque 500.
    throw new BackendError(502, { message: 'Unable to reach backend service' });
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body (e.g. an HTML error page from something in front of the
      // backend) — fall back to the raw text rather than throwing a raw
      // SyntaxError out of this function.
      body = text;
    }
  }

  if (!response.ok) {
    throw new BackendError(response.status, body);
  }
  return body;
}
