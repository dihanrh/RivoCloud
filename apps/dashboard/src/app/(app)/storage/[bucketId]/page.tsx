'use client';

import { use, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ObjectBrowser } from '@/components/storage/object-browser';
import { UploadButton } from '@/components/storage/upload-button';
import { ShareLinkDialog } from '@/components/storage/share-link-dialog';
import { useBucket } from '@/hooks/use-bucket';
import { useObjects } from '@/hooks/use-objects';
import { useDeleteObject } from '@/hooks/use-delete-object';

export default function BucketDetailPage({ params }: { params: Promise<{ bucketId: string }> }) {
  const { bucketId } = use(params);
  const { data: bucket } = useBucket(bucketId);
  const { data, isLoading, error } = useObjects(bucketId);
  const deleteObject = useDeleteObject(bucketId);
  const [shareKey, setShareKey] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{bucket?.name ?? 'Bucket'}</h1>
        <UploadButton bucketId={bucketId} />
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <p className="text-destructive">Failed to load objects.</p>}
      {data && (
        <ObjectBrowser
          objects={data.objects}
          onDelete={async (key) => {
            if (!window.confirm(`Delete "${key}"? This cannot be undone.`)) return;
            try {
              await deleteObject.mutateAsync(key);
            } catch {
              window.alert('Failed to delete the file. Please try again.');
            }
          }}
          onShare={setShareKey}
        />
      )}
      <ShareLinkDialog bucketId={bucketId} objectKey={shareKey} onOpenChange={(open) => !open && setShareKey(null)} />
    </div>
  );
}
