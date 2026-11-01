import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { backendFetch, BackendError } from '@/lib/backend-fetch';
import { clientForwardHeaders } from '@/lib/forwarded-headers';

/** Proxies a password-reset request. No session needed; the client IP is forwarded for rate limiting. */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const forwarded = await clientForwardHeaders();
  try {
    await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/forgot-password', {
      method: 'POST',
      body,
      headers: forwarded,
    });
    // Never echo anything that could reveal whether the account exists.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Request failed' }, { status: err.status });
    }
    throw err;
  }
}
