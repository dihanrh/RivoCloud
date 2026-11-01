import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ zoneId: string; ruleId: string }>;
}

function rulePath(zoneId: string, ruleId: string): string {
  return `/api/v1/zones/${encodeURIComponent(zoneId)}/rules/${encodeURIComponent(ruleId)}`;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { zoneId, ruleId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().CDN_SERVICE_URL, rulePath(zoneId, ruleId), { method: 'PATCH', body });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { zoneId, ruleId } = await params;
  return proxyToBackend(getEnv().CDN_SERVICE_URL, rulePath(zoneId, ruleId), { method: 'DELETE' });
}
