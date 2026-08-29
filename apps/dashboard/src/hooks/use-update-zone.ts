'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { UpdateZoneInput } from '@/lib/validation';
import type { Zone } from '@/lib/types';

export function useUpdateZone(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateZoneInput) =>
      apiFetch<Zone>(`/api/zones/${zoneId}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId] });
      void queryClient.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}
