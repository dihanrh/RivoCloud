'use client';

import { useState } from 'react';
import { AnalyticsFilters, type AnalyticsFilterState } from '@/components/analytics/analytics-filters';
import { BandwidthChart } from '@/components/analytics/bandwidth-chart';
import { CacheRatioGauge } from '@/components/analytics/cache-ratio-gauge';
import { GeographyTable } from '@/components/analytics/geography-table';
import { LatencyChart } from '@/components/analytics/latency-chart';
import { StatusCodeChart } from '@/components/analytics/status-code-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Zone } from '@/lib/types';
import { ZoneHeader } from './zone-shell';

const DAY_MS = 24 * 60 * 60 * 1000;

export function ZoneAnalytics({ zone }: { zone: Zone }) {
  const [params, setParams] = useState<AnalyticsFilterState>(() => {
    const to = new Date();
    return { rangeKey: '24h', zoneId: zone.id, from: new Date(to.getTime() - DAY_MS).toISOString(), to: to.toISOString() };
  });

  // This page is scoped to one website: only the range is selectable.
  function handleChange(next: AnalyticsFilterState) {
    setParams({ ...next, zoneId: zone.id });
  }

  return (
    <div>
      <ZoneHeader
        zone={zone}
        section="Analytics"
        description="Traffic served from the edge for this website."
        actions={<AnalyticsFilters params={params} onChange={handleChange} showZone={false} />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Bandwidth">
          <BandwidthChart params={params} />
        </ChartCard>
        <ChartCard title="Cache hit ratio">
          <CacheRatioGauge params={params} />
        </ChartCard>
        <ChartCard title="Latency (p50, p95, p99)">
          <LatencyChart params={params} />
        </ChartCard>
        <ChartCard title="Status codes">
          <StatusCodeChart params={params} />
        </ChartCard>
        <ChartCard title="Requests by country" className="lg:col-span-2">
          <GeographyTable params={params} />
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
