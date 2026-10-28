import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';
import { backendFetch, BackendError } from '@/lib/backend-fetch';
import { clientForwardHeaders } from '@/lib/forwarded-headers';
import { applySessionCookies, resolveSession } from '@/lib/auth-session';
import type { AuthTokens, Organization } from '@/lib/types';

export async function GET() {
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, '/api/v1/orgs', {}, { requireOrg: false });
}

export async function POST(request: NextRequest) {
  const session = await resolveSession();
  if (!session) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const body = await request.text();

  try {
    const result = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/orgs', {
      method: 'POST',
      body,
      accessToken: session.accessToken,
      headers: await clientForwardHeaders(),
    })) as AuthTokens & { organization: Organization };
    const { organization, ...tokens } = result;

    const response = NextResponse.json({ organization });
    applySessionCookies(response, tokens);
    return response;
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Failed to create organization' }, { status: err.status });
    }
    throw err;
  }
}
