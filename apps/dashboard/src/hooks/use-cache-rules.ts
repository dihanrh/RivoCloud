'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CacheRule, CacheRuleInput, CacheRuleList } from '@/lib/types';

function rulesPath(zoneId: string): string {
  return `/api/zones/${encodeURIComponent(zoneId)}/rules`;
}

const rulesKey = (zoneId: string) => ['zones', zoneId, 'rules'] as const;

export function useCacheRules(zoneId: string) {
  return useQuery({
    queryKey: rulesKey(zoneId),
    // The backend caps a page at 100; reordering needs every rule id, so fetch the max.
    queryFn: () => apiFetch<CacheRuleList>(`${rulesPath(zoneId)}?take=100`),
  });
}

export function useCreateCacheRule(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CacheRuleInput) =>
      apiFetch<CacheRule>(rulesPath(zoneId), { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rulesKey(zoneId) });
    },
  });
}

export function useUpdateCacheRule(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, input }: { ruleId: string; input: Partial<CacheRuleInput> }) =>
      apiFetch<CacheRule>(`${rulesPath(zoneId)}/${encodeURIComponent(ruleId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rulesKey(zoneId) });
    },
  });
}

export function useDeleteCacheRule(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) =>
      apiFetch<{ success: true }>(`${rulesPath(zoneId)}/${encodeURIComponent(ruleId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rulesKey(zoneId) });
    },
  });
}

export function useReorderCacheRules(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (order: string[]) =>
      apiFetch<CacheRuleList>(`${rulesPath(zoneId)}/reorder`, { method: 'POST', body: JSON.stringify({ order }) }),
    onSuccess: (data) => {
      if (data?.rules) queryClient.setQueryData(rulesKey(zoneId), data);
      void queryClient.invalidateQueries({ queryKey: rulesKey(zoneId) });
    },
  });
}
