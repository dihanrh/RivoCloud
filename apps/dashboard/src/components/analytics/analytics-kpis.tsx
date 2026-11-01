'use client';

import { Activity, ArrowDownUp, Gauge, Zap } from 'lucide-react';
import { useAnalyticsBandwidth, useAnalyticsLatency, useAnalyticsOverview } from '@/hooks/use-analytics';
import { formatBytes, formatCompact, formatNumber, formatPercent } from '@/lib/format';
import type { AnalyticsQueryParams } from '@/lib/types';
import { KpiTile } from './kpi-tile';

/**
 * The headline numbers for a range: requests and bandwidth (with sparklines from the
 * bandwidth series), cache hit ratio, and average p95 latency.
 */
export function AnalyticsKpis({ params, hint, showLatency = true }: { params: AnalyticsQueryParams; hint?: string; showLatency?: boolean }) {
  const overview = useAnalyticsOverview(params);
  const series = useAnalyticsBandwidth(params);
  const points = series.data?.series ?? [];
  const o = overview.data;

  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${showLatency ? 'xl:grid-cols-4' : 'lg:grid-cols-3'}`}>
      <KpiTile
        label="Requests"
        icon={Activity}
        loading={overview.isLoading}
        value={o ? <span title={formatNumber(o.requests)}>{formatCompact(o.requests)}</span> : '—'}
        hint={hint}
        trend={series.isLoading ? undefined : points.map((p) => p.requests)}
      />
      <KpiTile
        label="Bandwidth"
        icon={ArrowDownUp}
        loading={overview.isLoading}
        value={o ? formatBytes(Math.round(o.bytesSent)) : '—'}
        hint={hint}
        trend={series.isLoading ? undefined : points.map((p) => p.bytesSent)}
      />
      <KpiTile
        label="Cache hit ratio"
        icon={Zap}
        loading={overview.isLoading}
        value={o ? formatPercent(o.hitRatio) : '—'}
        hint="Requests served from the edge cache"
      />
      {showLatency && <LatencyKpi params={params} />}
    </div>
  );
}

function LatencyKpi({ params }: { params: AnalyticsQueryParams }) {
  const latency = useAnalyticsLatency(params);
  const points = latency.data?.series ?? [];
  const p95 = points.length ? points.reduce((sum, point) => sum + point.p95, 0) / points.length : null;
  return (
    <KpiTile
      label="p95 latency"
      icon={Gauge}
      loading={latency.isLoading}
      value={p95 === null ? '—' : `${Math.round(p95)} ms`}
      hint="Range average"
      trend={latency.isLoading ? undefined : points.map((point) => point.p95)}
    />
  );
}
