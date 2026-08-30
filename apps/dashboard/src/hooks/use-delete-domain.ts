'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useDeleteDomain(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) =>
      apiFetch<{ success: true }>(`/api/zones/${zoneId}/domains/${domainId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId, 'domains'] });
    },
  });
}
