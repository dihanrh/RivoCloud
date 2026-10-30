'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useDeleteZone(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: true }>(`/api/zones/${zoneId}`, { method: 'DELETE' }),
    onSuccess: () => {
      // Refresh the list only; refetching the deleted website would just 404.
      void queryClient.invalidateQueries({ queryKey: ['zones'], exact: true });
    },
  });
}
