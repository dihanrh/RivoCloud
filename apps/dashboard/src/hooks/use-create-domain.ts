'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CreateDomainInput } from '@/lib/validation';
import type { ZoneDomain } from '@/lib/types';

export function useCreateDomain(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDomainInput) =>
      apiFetch<ZoneDomain>(`/api/zones/${zoneId}/domains`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId, 'domains'] });
    },
  });
}
