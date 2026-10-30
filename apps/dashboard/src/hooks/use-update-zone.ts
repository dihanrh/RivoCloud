'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { UpdateZoneInput } from '@/lib/validation';
import type { Zone } from '@/lib/types';

export type OriginProtocol = 'http' | 'https' | 'match';

export function useUpdateZone(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateZoneInput & { originProtocol?: OriginProtocol }) =>
      apiFetch<Zone>(`/api/zones/${zoneId}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: (zone) => {
      if (zone?.id) queryClient.setQueryData(['zones', zoneId], zone);
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId] });
      void queryClient.invalidateQueries({ queryKey: ['zones'] });
    },
  });
}
