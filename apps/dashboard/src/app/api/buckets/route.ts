import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

export async function GET(request: NextRequest) {
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, `/api/v1/buckets${request.nextUrl.search}`);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, '/api/v1/buckets', { method: 'POST', body });
}
