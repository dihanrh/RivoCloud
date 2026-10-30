'use client';

import { use } from 'react';
import { ZoneDomains } from '@/components/zones/zone-domains';
import { ZoneGate, ZoneHeader } from '@/components/zones/zone-shell';

export default function ZoneDomainsPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return (
    <ZoneGate zoneId={zoneId}>
      {(zone) => (
        <div>
          <ZoneHeader
            zone={zone}
            section="Custom domains"
            description="Serve this website from hostnames you own. Certificates are issued and renewed automatically."
          />
          <ZoneDomains zoneId={zone.id} />
        </div>
      )}
    </ZoneGate>
  );
}
