'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useZones } from '@/hooks/use-zones';
import { useBuckets } from '@/hooks/use-buckets';

export default function DashboardOverviewPage() {
  const { data: zonesData } = useZones();
  const { data: bucketsData } = useBuckets();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/zones">
          <Card>
            <CardHeader>
              <CardTitle>Zones</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{zonesData?.total ?? '—'}</CardContent>
          </Card>
        </Link>
        <Link href="/storage">
          <Card>
            <CardHeader>
              <CardTitle>Buckets</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">{bucketsData?.total ?? '—'}</CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
