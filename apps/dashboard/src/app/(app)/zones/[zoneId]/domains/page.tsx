'use client';

import { use } from 'react';
import { ZoneDomains } from '@/components/zones/zone-domains';
import { ZoneGate } from '@/components/zones/zone-shell';

export default function ZoneDomainsPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return <ZoneGate zoneId={zoneId}>{(zone) => <ZoneDomains zone={zone} />}</ZoneGate>;
}
