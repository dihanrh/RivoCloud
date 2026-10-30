import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { backendFetch, BackendError } from '@/lib/backend-fetch';
import { applySessionCookies } from '@/lib/auth-session';
import { decodeAccessToken } from '@/lib/jwt';
import { clientForwardHeaders } from '@/lib/forwarded-headers';
import type { AuthTokens, Organization } from '@/lib/types';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const forwarded = await clientForwardHeaders();

  try {
    const tokens = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/login', {
      method: 'POST',
      body,
      headers: forwarded,
    })) as AuthTokens;

    const decoded = decodeAccessToken(tokens.accessToken);
    const org = decoded?.org ?? null;

    let orgs: Organization[] | undefined;
    if (!org) {
      orgs = (await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/orgs', {
        accessToken: tokens.accessToken,
        headers: forwarded,
      })) as Organization[];
    }

    const response = NextResponse.json({ org, orgs });
    applySessionCookies(response, tokens);
    return response;
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Login failed' }, { status: err.status });
    }
    throw err;
  }
}
