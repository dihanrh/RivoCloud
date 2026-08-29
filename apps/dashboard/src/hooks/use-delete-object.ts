'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useDeleteObject(bucketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => apiFetch<{ success: true }>(`/api/buckets/${bucketId}/objects/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buckets', bucketId, 'objects'] });
    },
  });
}
