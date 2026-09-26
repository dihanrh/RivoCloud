import { createHmac } from 'node:crypto';

// EDD Section 5.5's signature scheme, byte-for-byte what the Edge Proxy's
// internal/signedurl.Verify recomputes: message = "{expires}:{path}", where
// path is the DECODED URL path (Go's r.URL.Path), signed with HMAC-SHA256
// and hex-encoded lowercase.
export function signPath(secret: string, path: string, expires: number): string {
  return createHmac('sha256', secret).update(`${expires}:${path}`).digest('hex');
}

export interface SignedUrlParts {
  scheme: string;
  host: string;
  path: string;
  expires: number;
  sig: string;
}

// path is the decoded form that was signed; each segment is percent-encoded
// here, so a key like "reports/q3 2026.pdf" becomes /reports/q3%202026.pdf
// on the wire and decodes back to exactly the signed path at the edge.
export function buildSignedUrl({ scheme, host, path, expires, sig }: SignedUrlParts): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${scheme}://${host}${encodedPath}?expires=${expires}&sig=${sig}`;
}
