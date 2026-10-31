'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

/** Deletes an empty bucket. The storage service refuses (409) while it still holds files. */
export function useDeleteBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bucketId: string) => apiFetch<unknown>(`/api/buckets/${bucketId}`, { method: 'DELETE' }),
    onSuccess: (_data, bucketId) => {
      queryClient.removeQueries({ queryKey: ['buckets', bucketId] });
      void queryClient.invalidateQueries({ queryKey: ['buckets'] });
    },
  });
}
