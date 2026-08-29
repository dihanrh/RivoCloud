'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Bucket } from '@/lib/types';

export function useBucket(bucketId: string) {
  return useQuery({
    queryKey: ['buckets', bucketId],
    queryFn: () => apiFetch<Bucket>(`/api/buckets/${bucketId}`),
  });
}
