'use client';

import { useState } from 'react';
import { AnalyticsFilters, type AnalyticsFilterState } from '@/components/analytics/analytics-filters';
import { BandwidthChart } from '@/components/analytics/bandwidth-chart';
import { CacheRatioGauge } from '@/components/analytics/cache-ratio-gauge';
import { GeographyTable } from '@/components/analytics/geography-table';
import { StatusCodeChart } from '@/components/analytics/status-code-chart';
import { LatencyChart } from '@/components/analytics/latency-chart';

export default function AnalyticsPage() {
  const [params, setParams] = useState<AnalyticsFilterState>({ rangeKey: '24h' });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <AnalyticsFilters params={params} onChange={setParams} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Bandwidth</h2>
          <BandwidthChart params={params} />
        </div>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Cache hit ratio</h2>
          <CacheRatioGauge params={params} />
        </div>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Latency (P50/P95/P99)</h2>
          <LatencyChart params={params} />
        </div>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Status codes</h2>
          <StatusCodeChart params={params} />
        </div>
        <div className="rounded border border-border p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Requests by country</h2>
          <GeographyTable params={params} />
        </div>
      </div>
    </div>
  );
}
