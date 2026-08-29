'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { StorageObject } from '@/lib/types';

export function useObjects(bucketId: string) {
  return useQuery({
    queryKey: ['buckets', bucketId, 'objects'],
    queryFn: () => apiFetch<{ objects: StorageObject[]; total: number }>(`/api/buckets/${bucketId}/objects`),
    refetchInterval: (query) => {
      const hasPending = query.state.data?.objects.some((object) => object.status === 'pending');
      return hasPending ? 2000 : false;
    },
  });
}
