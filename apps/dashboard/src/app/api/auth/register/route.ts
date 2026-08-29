import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { backendFetch, BackendError } from '@/lib/backend-fetch';

export async function POST(request: NextRequest) {
  const body = await request.text();
  try {
    const user = await backendFetch(getEnv().IDENTITY_SERVICE_URL, '/api/v1/auth/register', {
      method: 'POST',
      body,
    });
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    if (err instanceof BackendError) {
      return NextResponse.json(err.body ?? { message: 'Registration failed' }, { status: err.status });
    }
    throw err;
  }
}
