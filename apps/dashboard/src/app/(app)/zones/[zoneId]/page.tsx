'use client';

import { use } from 'react';
import { ZoneOverview } from '@/components/zones/zone-overview';
import { ZoneGate } from '@/components/zones/zone-shell';

export default function ZoneOverviewPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return <ZoneGate zoneId={zoneId}>{(zone) => <ZoneOverview zone={zone} />}</ZoneGate>;
}
