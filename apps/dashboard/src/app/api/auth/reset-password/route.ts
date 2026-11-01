import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { backendFetch, BackendError } from '@/lib/backend-fetch';
import { clientForwardHeaders } from '@/lib/forwarded-headers';

/** Proxies a password reset with a one-time token. No session needed. */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const forwarded = await clientForwardHeaders();
  try {
    await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/reset-password', {
      method: 'POST',
      body,
      headers: forwarded,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Password reset failed' }, { status: err.status });
    }
    throw err;
  }
}
