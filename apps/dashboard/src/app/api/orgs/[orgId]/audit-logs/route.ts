import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
  return proxyToBackend(
    getEnv().IDENTITY_SERVICE_URL,
    `/api/v1/orgs/${encodeURIComponent(orgId)}/audit-logs${request.nextUrl.search}`,
  );
}
