'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type {
  AnalyticsOverview,
  AnalyticsBandwidth,
  AnalyticsRequests,
  AnalyticsCache,
  AnalyticsGeography,
  AnalyticsLatency,
  AnalyticsStatusCodes,
  AnalyticsTopPaths,
  AnalyticsQueryParams,
} from '@/lib/types';

export function toSearchParams(params: AnalyticsQueryParams): string {
  const search = new URLSearchParams();
  if (params.zoneId) search.set('zoneId', params.zoneId);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.granularity) search.set('granularity', params.granularity);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function useAnalytics<T>(key: string, params: AnalyticsQueryParams) {
  return useQuery({
    queryKey: ['analytics', key, params],
    queryFn: () => apiFetch<T>(`/api/analytics/${key}${toSearchParams(params)}`),
  });
}

export const useAnalyticsOverview = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsOverview>('overview', params);
export const useAnalyticsBandwidth = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsBandwidth>('bandwidth', params);
export const useAnalyticsRequests = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsRequests>('requests', params);
export const useAnalyticsCache = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsCache>('cache', params);
export const useAnalyticsGeography = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsGeography>('geography', params);
export const useAnalyticsLatency = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsLatency>('latency', params);
export const useAnalyticsStatusCodes = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsStatusCodes>('status-codes', params);
export const useAnalyticsTopPaths = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsTopPaths>('top-paths', params);
