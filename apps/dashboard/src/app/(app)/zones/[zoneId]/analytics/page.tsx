'use client';

import { use } from 'react';
import { ZoneAnalytics } from '@/components/zones/zone-analytics';
import { ZoneGate } from '@/components/zones/zone-shell';

export default function ZoneAnalyticsPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return <ZoneGate zoneId={zoneId}>{(zone) => <ZoneAnalytics zone={zone} />}</ZoneGate>;
}
