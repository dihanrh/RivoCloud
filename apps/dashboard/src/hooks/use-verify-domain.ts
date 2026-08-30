'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { ZoneDomain } from '@/lib/types';

export function useVerifyDomain(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) =>
      apiFetch<ZoneDomain>(`/api/zones/${zoneId}/domains/${domainId}/verify`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId, 'domains'] });
    },
  });
}
