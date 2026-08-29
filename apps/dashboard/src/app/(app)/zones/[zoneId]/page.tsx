'use client';

import { use } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ZoneDetail } from '@/components/zones/zone-detail';
import { useZone } from '@/hooks/use-zone';

export default function ZoneDetailPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  const { data: zone, isLoading, error } = useZone(zoneId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !zone) return <p className="text-destructive">Zone not found.</p>;

  return <ZoneDetail zone={zone} />;
}
