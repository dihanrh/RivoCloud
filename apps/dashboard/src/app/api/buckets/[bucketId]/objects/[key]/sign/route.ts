import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ bucketId: string; key: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { bucketId, key } = await params;
  const body = await request.text();
  return proxyToBackend(
    getEnv().STORAGE_SERVICE_URL,
    `/api/v1/buckets/${encodeURIComponent(bucketId)}/objects/${encodeURIComponent(key)}/sign`,
    { method: 'POST', body },
  );
}
