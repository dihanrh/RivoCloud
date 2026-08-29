import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ bucketId: string; key: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { bucketId, key } = await params;
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, `/api/v1/buckets/${bucketId}/objects/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}
