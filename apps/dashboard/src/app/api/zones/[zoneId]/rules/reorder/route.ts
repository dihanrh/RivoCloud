import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ zoneId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { zoneId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones/${encodeURIComponent(zoneId)}/rules/reorder`, {
    method: 'POST',
    body,
  });
}
