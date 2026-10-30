'use client';

import { use } from 'react';
import { ZoneSignedUrls } from '@/components/zones/zone-signed-urls';
import { ZoneGate, ZoneHeader } from '@/components/zones/zone-shell';

export default function ZoneSecurityPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return (
    <ZoneGate zoneId={zoneId}>
      {(zone) => (
        <div>
          <ZoneHeader zone={zone} section="Security" description="Control who can fetch content from this website." />
          <ZoneSignedUrls zone={zone} />
        </div>
      )}
    </ZoneGate>
  );
}
