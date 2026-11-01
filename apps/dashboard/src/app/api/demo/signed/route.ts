import { NextRequest, NextResponse } from 'next/server';
import { isDemoBackend } from '@/lib/env';

/**
 * Where demo-mode signed object URLs point. A real signed URL is served by the
 * edge for the website's hostname; the demo has no edge, so this explains the
 * link instead of serving bytes. Plain text only: nothing here is rendered as HTML.
 */
export async function GET(request: NextRequest) {
  if (!isDemoBackend()) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const q = request.nextUrl.searchParams;
  const clip = (value: string | null, max = 200) => (value ?? '').slice(0, max).replace(/[^\x20-\x7e]/g, '');
  const host = clip(q.get('host'));
  const path = clip(q.get('path'), 500);
  const expires = Number(q.get('expires'));
  const valid = Number.isFinite(expires) && expires * 1000 > Date.now();
  const expiresAt = Number.isFinite(expires) ? new Date(expires * 1000).toISOString() : 'unknown';

  const lines = [
    'RivoCloud demo - signed link',
    '',
    valid ? 'This link is valid.' : 'This link has expired.',
    `Expires: ${expiresAt}`,
    '',
    'In a real deployment this URL is served by the RivoCloud edge at:',
    `  https://${host}${path}?expires=${Number.isFinite(expires) ? expires : ''}&sig=...`,
    'The edge checks the HMAC signature and expiry before returning the object.',
    '',
    'This demo has no edge network or object store, so no file is served.',
  ];
  return new NextResponse(lines.join('\n') + '\n', {
    status: valid ? 200 : 410,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
  });
}
