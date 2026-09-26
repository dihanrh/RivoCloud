import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

export async function GET(request: NextRequest) {
  return proxyToBackend(getEnv().ANALYTICS_SERVICE_URL, `/api/v1/analytics/requests${request.nextUrl.search}`);
}
