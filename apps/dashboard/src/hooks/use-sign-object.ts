'use client';

import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { SignedUrl } from '@/lib/types';

export interface SignObjectInput {
  key: string;
  zoneId: string;
  expiresIn: number;
  download: boolean;
}

export function useSignObject(bucketId: string) {
  return useMutation({
    mutationFn: ({ key, ...body }: SignObjectInput) =>
      apiFetch<SignedUrl>(`/api/buckets/${bucketId}/objects/${encodeURIComponent(key)}/sign`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}
