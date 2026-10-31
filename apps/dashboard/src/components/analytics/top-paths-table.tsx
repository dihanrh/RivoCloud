'use client';

import { useAnalyticsTopPaths } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { ShareTable } from './share-table';

export function TopPathsTable({ params, limit = 10 }: { params: AnalyticsQueryParams; limit?: number }) {
  const { data, isLoading, error } = useAnalyticsTopPaths(params);
  const paths = [...(data?.paths ?? [])].sort((a, b) => b.requests - a.requests).slice(0, limit);
  return (
    <ShareTable
      labelHeader="Path"
      loading={isLoading}
      error={!!error}
      rows={paths.map((p) => ({
        key: p.path,
        requests: p.requests,
        bytesSent: p.bytesSent,
        label: (
          <span className="font-mono text-xs" title={p.path}>
            {p.path}
          </span>
        ),
      }))}
    />
  );
}
