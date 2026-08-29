'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { ZoneList } from '@/components/zones/zone-list';
import { CreateZoneDialog } from '@/components/zones/create-zone-dialog';
import { useZones } from '@/hooks/use-zones';

export default function ZonesPage() {
  const { data, isLoading, error } = useZones();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Zones</h1>
        <CreateZoneDialog />
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <p className="text-destructive">Failed to load zones.</p>}
      {data && <ZoneList zones={data.zones} />}
    </div>
  );
}
