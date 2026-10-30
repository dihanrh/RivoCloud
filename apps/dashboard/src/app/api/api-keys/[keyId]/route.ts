import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ keyId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { keyId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, `/api/v1/api-keys/${encodeURIComponent(keyId)}`, {
    method: 'PATCH',
    body,
  });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { keyId } = await params;
  return proxyToBackend(getEnv().IDENTITY_SERVICE_URL, `/api/v1/api-keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
  });
}
