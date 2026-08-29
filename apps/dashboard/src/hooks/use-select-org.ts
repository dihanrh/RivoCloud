'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useSelectOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => apiFetch<{ org: string }>('/api/orgs/select', { method: 'POST', body: JSON.stringify({ orgId }) }),
    onSuccess: () => {
      // Switching orgs invalidates every org-scoped query (zones, buckets, objects, …) —
      // clear the whole cache so the new org's data is fetched fresh instead of briefly
      // showing the previous org's cached results.
      queryClient.clear();
    },
  });
}
