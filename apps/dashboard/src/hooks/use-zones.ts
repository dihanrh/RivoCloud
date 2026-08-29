'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Zone } from '@/lib/types';

export function useZones() {
  return useQuery({
    queryKey: ['zones'],
    queryFn: () => apiFetch<{ zones: Zone[]; total: number }>('/api/zones'),
  });
}
