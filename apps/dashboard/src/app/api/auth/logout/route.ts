import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';
import { backendFetch } from '@/lib/backend-fetch';
import { clearSessionCookies } from '@/lib/auth-session';
import { REFRESH_COOKIE } from '@/lib/cookies';

export async function POST() {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    try {
      await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // best-effort: the cookies are cleared regardless of whether the backend call succeeds
    }
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookies(response);
  return response;
}
