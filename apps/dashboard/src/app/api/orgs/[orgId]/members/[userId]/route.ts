import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ orgId: string; userId: string }>;
}

function memberPath(orgId: string, userId: string) {
  return `/api/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { orgId, userId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, memberPath(orgId, userId), { method: 'PATCH', body });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { orgId, userId } = await params;
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, memberPath(orgId, userId), { method: 'DELETE' });
}
