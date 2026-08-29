'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

interface InitiateUploadResponse {
  objectId: string;
  uploadUrl: string;
}

export function useInitiateUpload(bucketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const key = `${crypto.randomUUID().slice(0, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { uploadUrl } = await apiFetch<InitiateUploadResponse>(`/api/buckets/${bucketId}/objects/upload`, {
        method: 'POST',
        body: JSON.stringify({ key, contentType: file.type || 'application/octet-stream', size: file.size }),
      });

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!putResponse.ok) {
        throw new Error(`Upload to storage failed with status ${putResponse.status}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buckets', bucketId, 'objects'] });
    },
  });
}
