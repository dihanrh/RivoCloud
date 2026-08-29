import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { resolveSession } from '@/lib/auth-session';
import { backendFetch, BackendError } from '@/lib/backend-fetch';

export async function GET() {
  const session = await resolveSession();
  if (!session) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  try {
    const profile = await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/users/me', {
      accessToken: session.accessToken,
    });
    return NextResponse.json({ ...(profile as object), orgId: session.org });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Failed to load profile' }, { status: err.status });
    }
    throw err;
  }
}
