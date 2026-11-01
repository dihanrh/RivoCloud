'use client';

import { useState } from 'react';
import { AnalyticsFilters, rangeLabel, type AnalyticsFilterState } from '@/components/analytics/analytics-filters';
import { AnalyticsKpis } from '@/components/analytics/analytics-kpis';
import { BandwidthChart } from '@/components/analytics/bandwidth-chart';
import { CacheRatioGauge } from '@/components/analytics/cache-ratio-gauge';
import { ChartCard } from '@/components/analytics/chart-card';
import { GeographyTable } from '@/components/analytics/geography-table';
import { LatencyChart } from '@/components/analytics/latency-chart';
import { StatusCodeChart } from '@/components/analytics/status-code-chart';
import { TopPathsTable } from '@/components/analytics/top-paths-table';
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
      <div className="flex flex-col gap-4">
        <AnalyticsKpis params={params} hint={rangeLabel(params.rangeKey)} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartCard title="Traffic" description="Bandwidth and requests served to visitors" className="lg:col-span-2">
            <BandwidthChart params={params} />
          </ChartCard>
          <ChartCard title="Cache performance" description="How each request was answered">
            <CacheRatioGauge params={params} />
          </ChartCard>
          <ChartCard title="Latency" description="Time to first byte at the p50, p95 and p99 percentiles" className="lg:col-span-2">
            <LatencyChart params={params} />
          </ChartCard>
          <ChartCard title="Status codes" description="Responses by HTTP status class">
            <StatusCodeChart params={params} />
          </ChartCard>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Top paths" description="Most requested URLs" flush>
            <TopPathsTable params={params} />
          </ChartCard>
          <ChartCard title="Countries" description="Where requests come from" flush>
            <GeographyTable params={params} />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
