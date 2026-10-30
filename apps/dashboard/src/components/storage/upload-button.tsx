'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useInitiateUpload } from '@/hooks/use-initiate-upload';

export function UploadButton({ bucketId }: { bucketId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const initiateUpload = useInitiateUpload(bucketId);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    try {
      await initiateUpload.mutateAsync(file);
    } catch {
      setError('Could not upload the file. Try again.');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
      <Button onClick={() => inputRef.current?.click()} disabled={initiateUpload.isPending}>
        {initiateUpload.isPending ? 'Uploading…' : 'Upload file'}
      </Button>
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
    </div>
  );
}
