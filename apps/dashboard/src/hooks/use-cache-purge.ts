'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CacheInvalidationList, CacheInvalidationResult } from '@/lib/types';

function cachePath(zoneId: string): string {
  return `/api/zones/${encodeURIComponent(zoneId)}/cache`;
}

const invalidationsKey = (zoneId: string) => ['zones', zoneId, 'invalidations'] as const;

export function useInvalidations(zoneId: string, take = 20) {
  return useQuery({
    queryKey: [...invalidationsKey(zoneId), take],
    queryFn: () => apiFetch<CacheInvalidationList>(`${cachePath(zoneId)}/invalidations?take=${take}`),
    // A purge finishes within seconds; poll only while one is still running.
    refetchInterval: (query) =>
      query.state.data?.invalidations?.some((inv) => inv.status === 'pending') ? 3000 : false,
  });
}

export function usePurgeEverything(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<CacheInvalidationResult>(`${cachePath(zoneId)}/purge`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidationsKey(zoneId) });
    },
  });
}

export function useInvalidateCache(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { patterns?: string[]; tags?: string[] }) =>
      apiFetch<CacheInvalidationResult>(`${cachePath(zoneId)}/invalidate`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invalidationsKey(zoneId) });
    },
  });
}
