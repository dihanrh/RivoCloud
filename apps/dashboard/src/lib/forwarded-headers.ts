import { headers } from 'next/headers';

// Backend services only trust X-Forwarded-For from private hops, so the
// dashboard relays the browser's address and user agent on every backend call.
// The header is passed through as received, so the dashboard MUST sit behind a reverse
// proxy (e.g. Traefik, default forwardedHeaders handling) that overwrites/appends
// X-Forwarded-For with the real client address, and services must only be reachable from
// private networks. Otherwise client IPs (rate limits, audit logs) can be spoofed, or every
// user collapses into the dashboard's single IP bucket.
export async function clientForwardHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const result: Record<string, string> = {};
  const forwardedFor = incoming.get('x-forwarded-for');
  if (forwardedFor) result['X-Forwarded-For'] = forwardedFor;
  const userAgent = incoming.get('user-agent');
  if (userAgent) result['User-Agent'] = userAgent;
  return result;
}
