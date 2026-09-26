import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ zoneId: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { zoneId } = await params;
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones/${encodeURIComponent(zoneId)}/signing-secret/rotate`, {
    method: 'POST',
  });
}
