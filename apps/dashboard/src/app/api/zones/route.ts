import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

export async function GET(request: NextRequest) {
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones${request.nextUrl.search}`);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToBackend(getEnv().CDN_SERVICE_URL, '/api/v1/zones', { method: 'POST', body });
}
