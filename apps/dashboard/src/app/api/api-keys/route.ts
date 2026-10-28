import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

export async function GET() {
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, '/api/v1/api-keys');
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, '/api/v1/api-keys', { method: 'POST', body });
}
