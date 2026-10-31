'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useInitiateUpload } from '@/hooks/use-initiate-upload';
import { formatBytes } from '@/lib/format';
import { ApiError, errorMessage } from '@/lib/http';

/**
 * Picks a file and uploads it. The button shows the percentage sent while it works (and keeps
 * its width), then a toast reports the result.
 */
export function UploadButton({ bucketId, variant }: { bucketId: string; variant?: ButtonProps['variant'] }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useInitiateUpload(bucketId, { onProgress: setProgress });

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setProgress(0);
    try {
      await upload.mutateAsync(file);
      toast.success('File uploaded', `${file.name} (${formatBytes(file.size)})`);
    } catch (err) {
      const detail = err instanceof ApiError ? errorMessage(err, 'Try again.') : err instanceof Error ? err.message : 'Try again.';
      toast.error('Could not upload the file', detail);
    } finally {
      setProgress(null);
    }
  }

  const pending = upload.isPending;
  const pct = progress === null ? null : Math.round(progress * 100);

  return (
    <>
      <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} data-testid="upload-input" />
      <Button
        variant={variant}
        leftIcon={<Upload />}
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        aria-busy={pending || undefined}
        className="relative min-w-32 overflow-hidden"
      >
        {pending && pct !== null && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        )}
        <span className="relative tabular-nums">{pending ? `Uploading ${pct ?? 0}%` : 'Upload file'}</span>
      </Button>
      {pending && (
        <span className="sr-only" role="status">
          Uploading, {pct ?? 0}% sent
        </span>
      )}
    </>
  );
}
