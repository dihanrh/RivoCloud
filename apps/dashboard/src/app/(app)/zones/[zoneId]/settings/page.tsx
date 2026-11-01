'use client';

import { use } from 'react';
import { ZoneSettings } from '@/components/zones/zone-settings';
import { ZoneGate } from '@/components/zones/zone-shell';

export default function ZoneSettingsPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return <ZoneGate zoneId={zoneId}>{(zone) => <ZoneSettings zone={zone} />}</ZoneGate>;
}
