import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { backendFetch, BackendError } from '@/lib/backend-fetch';
import { clientForwardHeaders } from '@/lib/forwarded-headers';
import { applySessionCookies, resolveSession } from '@/lib/auth-session';
import type { AuthTokens } from '@/lib/types';

export async function POST(request: NextRequest) {
  const session = await resolveSession();
  if (!session) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const { orgId } = (await request.json()) as { orgId: string };

  try {
    const tokens = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/select-org', {
      method: 'POST',
      body: JSON.stringify({ orgId }),
      accessToken: session.accessToken,
      headers: await clientForwardHeaders(),
    })) as AuthTokens;

    const response = NextResponse.json({ org: orgId });
    applySessionCookies(response, tokens);
    return response;
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Failed to select organization' }, { status: err.status });
    }
    throw err;
  }
}
