import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { applySessionCookies, resolveSession } from '@/lib/auth-session';
import { backendFetch, BackendError } from '@/lib/backend-fetch';
import { clientForwardHeaders } from '@/lib/forwarded-headers';
import type { OrgRole } from '@/lib/types';

export async function GET() {
  const session = await resolveSession();
  if (!session) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  try {
    const profile = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/users/me', {
      accessToken: session.accessToken,
      headers: await clientForwardHeaders(),
    })) as { role?: OrgRole | null };
    // Identity reports the live role; the access token's role claim can be stale after a role change.
    const response = NextResponse.json({ ...profile, orgId: session.org, role: profile.role ?? null });
    if (session.newTokens) applySessionCookies(response, session.newTokens);
    return response;
  } catch (err) {
    if (err instanceof BackendError) {
      const response = NextResponse.json(err.body ?? { message: 'Failed to load profile' }, { status: err.status });
      if (session.newTokens) applySessionCookies(response, session.newTokens);
      return response;
    }
    throw err;
  }
}
