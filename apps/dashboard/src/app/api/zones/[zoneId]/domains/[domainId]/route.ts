import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ zoneId: string; domainId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { zoneId, domainId } = await params;
  return proxyToBackend(
    getEnv().CDN_SERVICE_URL,
    `/api/v1/zones/${encodeURIComponent(zoneId)}/domains/${encodeURIComponent(domainId)}`,
    { method: 'DELETE' },
  );
}
