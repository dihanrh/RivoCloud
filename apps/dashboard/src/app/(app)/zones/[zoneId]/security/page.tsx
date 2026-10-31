'use client';

import { use } from 'react';
import { ZoneSecurity } from '@/components/zones/zone-signed-urls';
import { ZoneGate } from '@/components/zones/zone-shell';

export default function ZoneSecurityPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return <ZoneGate zoneId={zoneId}>{(zone) => <ZoneSecurity zone={zone} />}</ZoneGate>;
}
