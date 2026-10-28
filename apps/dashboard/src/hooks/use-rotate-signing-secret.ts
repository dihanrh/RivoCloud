'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Zone } from '@/lib/types';

export function useRotateSigningSecret(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Zone>(`/api/zones/${zoneId}/signing-secret/rotate`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId] });
    },
  });
}
