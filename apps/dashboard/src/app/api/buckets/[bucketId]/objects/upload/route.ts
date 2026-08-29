import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ bucketId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { bucketId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().STORAGE_SERVICE_URL, `/api/v1/buckets/${bucketId}/objects/upload`, {
    method: 'POST',
    body,
  });
}
