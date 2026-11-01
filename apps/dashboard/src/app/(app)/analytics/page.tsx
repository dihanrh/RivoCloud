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
      <PageHeader
        title="Analytics"
        description={
          <span aria-live="polite">
            Traffic served from the edge for <span className="font-medium text-foreground">{zoneName ?? 'all websites'}</span> ·{' '}
            {range}
          </span>
        }
        actions={<AnalyticsFilters params={params} onChange={setParams} />}
      />
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
          </>
        )}
      </div>
    </>
  );
}
