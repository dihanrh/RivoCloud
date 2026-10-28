import { NextResponse } from 'next/server';
import { applySessionCookies, resolveSession } from './auth-session';
import { backendFetch, BackendError } from './backend-fetch';
import { clientForwardHeaders } from './forwarded-headers';

export async function proxyToBackend(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  opts: { requireOrg?: boolean } = {},
): Promise<NextResponse> {
  const session = await resolveSession();
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  if (opts.requireOrg !== false && !session.org) {
    return NextResponse.json({ message: 'Select an organization first' }, { status: 409 });
  }

  try {
    const forwarded = await clientForwardHeaders();
    const data = await backendFetch(baseUrl, path, {
      ...init,
      headers: { ...forwarded, ...(init.headers as Record<string, string> | undefined) },
      accessToken: session.accessToken,
    });
    const response = NextResponse.json(data ?? {});
    if (session.newTokens) applySessionCookies(response, session.newTokens);
    return response;
  } catch (err) {
    if (err instanceof BackendError) {
      const response = NextResponse.json(err.body ?? { message: 'Backend error' }, { status: err.status });
      if (session.newTokens) applySessionCookies(response, session.newTokens);
      return response;
    }
    throw err;
  }
}
