'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

interface InitiateUploadResponse {
  objectId: string;
  uploadUrl: string;
}

export interface UploadOptions {
  /** Called with a 0–1 fraction while the file body is sent to storage. */
  onProgress?: (fraction: number) => void;
}

function putWithProgress(url: string, file: File, contentType: string, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(`Upload to storage failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload to storage failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

/** Returns the generated object key. */
export function useInitiateUpload(bucketId: string, options: UploadOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const key = `${crypto.randomUUID().slice(0, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const contentType = file.type || 'application/octet-stream';
      const { uploadUrl } = await apiFetch<InitiateUploadResponse>(`/api/buckets/${bucketId}/objects/upload`, {
        method: 'POST',
        body: JSON.stringify({ key, contentType, size: file.size }),
      });

      if (options.onProgress) {
        await putWithProgress(uploadUrl, file, contentType, options.onProgress);
        return key;
      }
      const putResponse = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
      if (!putResponse.ok) {
        throw new Error(`Upload to storage failed with status ${putResponse.status}`);
      }
      return key;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['buckets', bucketId, 'objects'] });
    },
  });
}
