import { NextRequest, NextResponse } from 'next/server';
import { isDemoBackend } from '@/lib/env';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Demo-mode stand-in for the object store's presigned PUT URL. The bytes are
 * counted and discarded; the pending object is marked ready, like the store's
 * upload notification would. Only exists when RIVO_DEMO_BACKEND=mock.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  if (!isDemoBackend()) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const { id } = await params;

  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
    }
  }

  const [{ demoWorld }, { completeUpload }] = await Promise.all([
    import('@/lib/demo-backend'),
    import('@/lib/demo-backend/routes/storage'),
  ]);
  const object = completeUpload(await demoWorld(), id, size);
  if (!object) {
    return NextResponse.json({ statusCode: 404, message: 'Upload not found or expired', error: 'Not Found' }, { status: 404 });
  }
  return new NextResponse(null, { status: 200, headers: { ETag: `"${object.etag}"` } });
}
