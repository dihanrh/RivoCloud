'use client';

import { use, useState } from 'react';
import { StatusDot } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { ErrorBanner } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ObjectBrowser } from '@/components/storage/object-browser';
import { ReadOnlyNote } from '@/components/storage/read-only-note';
import { ShareLinkDialog } from '@/components/storage/share-link-dialog';
import { UploadButton } from '@/components/storage/upload-button';
import { useStoragePermissions } from '@/components/storage/use-storage-permissions';
import { useBucket } from '@/hooks/use-bucket';
import { useDeleteObject } from '@/hooks/use-delete-object';
import { useObjects } from '@/hooks/use-objects';
import { formatBytes } from '@/lib/format';
import { ApiError } from '@/lib/http';
import { useMounted } from '@/hooks/use-mounted';
import Loading from './loading';

/** A skeleton that is valid inside headings and paragraphs (PageHeader title/description). */
function InlineSkeleton({ className }: { className?: string }) {
  return <span aria-hidden className={`inline-block max-w-full animate-pulse rounded-md bg-[#e9ebee] align-middle ${className ?? ''}`} />;
}

export default function BucketDetailPage({ params }: { params: Promise<{ bucketId: string }> }) {
  const mounted = useMounted();
  const { bucketId } = use(params);
  const { data: bucket, error: bucketError } = useBucket(bucketId);
  const { data, isLoading, error, refetch } = useObjects(bucketId);
  const { ready, canWrite, canDelete } = useStoragePermissions();
  const deleteObject = useDeleteObject(bucketId);
  const [shareKey, setShareKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  // Render the route's skeleton until hydrated; see useMounted.
  if (!mounted) return <Loading />;

  if (bucketError instanceof ApiError && bucketError.status === 404) {
    return (
      <>
        <PageHeader title="Bucket not found" crumbs={[{ label: 'Storage', href: '/storage' }, { label: 'Not found' }]} />
        <ErrorBanner>This bucket doesn&apos;t exist or was deleted. Go back to Storage to pick another one.</ErrorBanner>
      </>
    );
  }

  const files = data?.objects.filter((o) => o.status !== 'deleted') ?? [];
  const totalBytes = files.reduce((sum, o) => sum + (o.size ? Number(o.size) : 0), 0);

  return (
    <>
      <PageHeader
        title={bucket?.name ?? <InlineSkeleton className="h-7 w-48" />}
        description={
          bucket ? (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusDot tone={bucket.public ? 'warning' : 'muted'}>{bucket.public ? 'Public' : 'Private'}</StatusDot>
              <span aria-hidden>·</span>
              <span>{bucket.region}</span>
              {data && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">
                    {files.length} {files.length === 1 ? 'file' : 'files'}, {formatBytes(totalBytes)}
                  </span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 font-mono text-xs">
                {bucket.id.slice(0, 8)}
                <CopyButton value={bucket.id} label="Copy bucket ID" />
              </span>
            </span>
          ) : (
            <InlineSkeleton className="h-4 w-64" />
          )
        }
        crumbs={[{ label: 'Storage', href: '/storage' }, { label: bucket?.name ?? 'Bucket' }]}
        actions={canWrite ? <UploadButton bucketId={bucketId} /> : undefined}
      />
      {ready && !canWrite && <ReadOnlyNote>Your role can view and share files. Ask an owner or admin to upload or delete.</ReadOnlyNote>}
      <ObjectBrowser
        objects={data?.objects}
        loading={isLoading}
        error={!!error}
        onRetry={() => void refetch()}
        emptyAction={canWrite ? <UploadButton bucketId={bucketId} /> : undefined}
        onDelete={canDelete ? setDeletingKey : undefined}
        onShare={setShareKey}
      />
      <ShareLinkDialog bucketId={bucketId} objectKey={shareKey} onOpenChange={(open) => !open && setShareKey(null)} />
      <ConfirmDialog
        open={deletingKey !== null}
        onOpenChange={(open) => !open && setDeletingKey(null)}
        tone="destructive"
        title="Delete file"
        description={
          <>
            This permanently deletes <span className="break-all font-semibold text-foreground">{deletingKey}</span>. Share links to it stop
            working.
          </>
        }
        confirmLabel="Delete file"
        successToast={{ title: 'File deleted', description: deletingKey ?? undefined }}
        errorFallback="Could not delete the file. Try again."
        onConfirm={async () => {
          if (deletingKey) await deleteObject.mutateAsync(deletingKey);
        }}
      />
    </>
  );
}
