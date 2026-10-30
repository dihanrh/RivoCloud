'use client';

import { use, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
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
    <>
      <PageHeader
        title={bucket?.name ?? 'Bucket'}
        description={bucket ? `${bucket.region}, ${bucket.public ? 'public' : 'private'} bucket` : undefined}
        crumbs={[{ label: 'Storage', href: '/storage' }, { label: bucket?.name ?? 'Bucket' }]}
        actions={<UploadButton bucketId={bucketId} />}
      />
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <ErrorBanner>Could not load the files in this bucket. Refresh the page to try again.</ErrorBanner>}
      {data && (
        <ObjectBrowser
          objects={data.objects}
          emptyAction={<UploadButton bucketId={bucketId} />}
          onDelete={async (key) => {
            if (!window.confirm(`Delete "${key}"? This cannot be undone.`)) return;
            try {
              await deleteObject.mutateAsync(key);
            } catch {
              window.alert('Could not delete the file. Try again.');
            }
          }}
          onShare={setShareKey}
        />
      )}
      <ShareLinkDialog bucketId={bucketId} objectKey={shareKey} onOpenChange={(open) => !open && setShareKey(null)} />
    </>
  );
}
