'use client';

import { useState } from 'react';
import { AnalyticsFilters, type AnalyticsFilterState } from '@/components/analytics/analytics-filters';
import { BandwidthChart } from '@/components/analytics/bandwidth-chart';
import { CacheRatioGauge } from '@/components/analytics/cache-ratio-gauge';
import { GeographyTable } from '@/components/analytics/geography-table';
import { StatusCodeChart } from '@/components/analytics/status-code-chart';
import { LatencyChart } from '@/components/analytics/latency-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

function Panel({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [params, setParams] = useState<AnalyticsFilterState>({ rangeKey: '24h' });

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Traffic across all of your websites, or pick one to focus on."
        actions={<AnalyticsFilters params={params} onChange={setParams} />}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Bandwidth">
          <BandwidthChart params={params} />
        </Panel>
        <Panel title="Cache hit ratio">
          <CacheRatioGauge params={params} />
        </Panel>
        <Panel title="Latency (p50, p95, p99)">
          <LatencyChart params={params} />
        </Panel>
        <Panel title="Status codes">
          <StatusCodeChart params={params} />
        </Panel>
        <Panel title="Requests by country" className="lg:col-span-2">
          <GeographyTable params={params} />
        </Panel>
      </div>
    </>
  );
}
