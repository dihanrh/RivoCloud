'use client';

import { use } from 'react';
import { ZoneCaching } from '@/components/zones/zone-caching';
import { ZoneGate } from '@/components/zones/zone-shell';

export default function ZoneCachingPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return <ZoneGate zoneId={zoneId}>{(zone) => <ZoneCaching zone={zone} />}</ZoneGate>;
}
