'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Bucket } from '@/lib/types';

export function useBuckets() {
  return useQuery({
    queryKey: ['buckets'],
    queryFn: () => apiFetch<{ buckets: Bucket[]; total: number }>('/api/buckets'),
  });
}
