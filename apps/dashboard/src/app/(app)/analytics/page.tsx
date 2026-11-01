'use client';

import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { AnalyticsFilters, rangeLabel, type AnalyticsFilterState } from '@/components/analytics/analytics-filters';
import { AnalyticsKpis } from '@/components/analytics/analytics-kpis';
import { BandwidthChart } from '@/components/analytics/bandwidth-chart';
import { CacheRatioGauge } from '@/components/analytics/cache-ratio-gauge';
import { ChartCard } from '@/components/analytics/chart-card';
import { GeographyTable } from '@/components/analytics/geography-table';
import { LatencyChart } from '@/components/analytics/latency-chart';
import { StatusCodeChart } from '@/components/analytics/status-code-chart';
import { TopPathsTable } from '@/components/analytics/top-paths-table';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useAnalyticsOverview } from '@/hooks/use-analytics';
import { useZones } from '@/hooks/use-zones';
import { useMounted } from '@/hooks/use-mounted';
import Loading from './loading';

export default function AnalyticsPage() {
  const mounted = useMounted();
  const [params, setParams] = useState<AnalyticsFilterState>({ rangeKey: '24h' });
  const overview = useAnalyticsOverview(params);
  const { data: zoneData } = useZones();
  const range = rangeLabel(params.rangeKey);
  const zoneName = params.zoneId ? zoneData?.zones.find((z) => z.id === params.zoneId)?.name : undefined;
  const noTraffic = overview.data?.requests === 0;

  // Render the route's skeleton until hydrated; see useMounted.
  if (!mounted) return <Loading />;

  return (
    <>
      <PageHeader title="Analytics" description="Traffic served from the edge across your websites. Pick a website to focus on one." />
      <div className="mb-4 flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
        <AnalyticsFilters params={params} onChange={setParams} />
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {zoneName ?? 'All websites'} · {range}
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <AnalyticsKpis params={params} hint={range} />
        {noTraffic ? (
          <Card>
            <EmptyState
              icon={BarChart3}
              title="No traffic in this range"
              description="Requests to your websites show up here within a minute or two. Try a longer range, or another website."
            />
          </Card>
        ) : (
          <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard title="Bandwidth" description="Bytes sent to visitors" className="lg:col-span-2">
              <BandwidthChart params={params} />
            </ChartCard>
            <ChartCard title="Cache hit ratio" description="Share of requests served from cache">
              <CacheRatioGauge params={params} />
            </ChartCard>
            <ChartCard title="Latency" description="p50, p95 and p99 time to first byte" className="lg:col-span-2">
              <LatencyChart params={params} />
            </ChartCard>
            <ChartCard title="Status codes" description="Responses by HTTP status">
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
          </>
        )}
      </div>
    </>
  );
}
