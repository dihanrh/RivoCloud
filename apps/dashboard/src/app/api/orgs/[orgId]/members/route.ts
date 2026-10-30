import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ orgId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, `/api/v1/orgs/${encodeURIComponent(orgId)}/members`);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { orgId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, `/api/v1/orgs/${encodeURIComponent(orgId)}/members`, {
    method: 'POST',
    body,
  });
}
