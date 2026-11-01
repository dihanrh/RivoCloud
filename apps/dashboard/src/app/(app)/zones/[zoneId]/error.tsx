'use client';

import { ZoneLoadError } from '@/components/zones/zone-shell';

/** Unexpected render error on a website page: same banner as a failed load, with a retry. */
export default function ZoneError({ reset }: { error: Error; reset: () => void }) {
  return <ZoneLoadError onRetry={reset} />;
}
