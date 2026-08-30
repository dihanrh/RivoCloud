'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { ZoneDomain } from '@/lib/types';

export function useDomains(zoneId: string) {
  return useQuery({
    queryKey: ['zones', zoneId, 'domains'],
    queryFn: () => apiFetch<ZoneDomain[]>(`/api/zones/${zoneId}/domains`),
  });
}
