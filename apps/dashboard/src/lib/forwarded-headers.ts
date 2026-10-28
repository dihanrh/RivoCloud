import { headers } from 'next/headers';

// Backend services only trust X-Forwarded-For from private hops, so the
// dashboard relays the browser's address and user agent on every backend call.
export async function clientForwardHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const result: Record<string, string> = {};
  const forwardedFor = incoming.get('x-forwarded-for');
  if (forwardedFor) result['X-Forwarded-For'] = forwardedFor;
  const userAgent = incoming.get('user-agent');
  if (userAgent) result['User-Agent'] = userAgent;
  return result;
}
