'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CreateBucketInput } from '@/lib/validation';
import type { Bucket } from '@/lib/types';

export function useCreateBucket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBucketInput) => apiFetch<Bucket>('/api/buckets', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buckets'] });
    },
  });
}
