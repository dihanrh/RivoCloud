'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Zone } from '@/lib/types';

export function useZone(zoneId: string) {
  return useQuery({
    queryKey: ['zones', zoneId],
    queryFn: () => apiFetch<Zone>(`/api/zones/${zoneId}`),
  });
}
