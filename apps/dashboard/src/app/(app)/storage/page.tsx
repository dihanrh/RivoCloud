'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageHeader } from '@/components/ui/page-header';
import { BucketList } from '@/components/storage/bucket-list';
import { CreateBucketDialog } from '@/components/storage/create-bucket-dialog';
import { ReadOnlyNote } from '@/components/storage/read-only-note';
import { useStoragePermissions } from '@/components/storage/use-storage-permissions';
import { useBuckets } from '@/hooks/use-buckets';
import { useDeleteBucket } from '@/hooks/use-delete-bucket';
import { useQuickActionParam } from '@/hooks/use-quick-action-param';
import type { Bucket } from '@/lib/types';
import { useMounted } from '@/hooks/use-mounted';
import Loading from './loading';

export default function StoragePage() {
  const mounted = useMounted();
  const { data, isLoading, error, refetch } = useBuckets();
  const { ready, canWrite, canDelete } = useStoragePermissions();
  const deleteBucket = useDeleteBucket();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<Bucket | null>(null);

  // The command palette's "Create bucket" lands here with ?create=1. Wait for the role so a
  // viewer following an old link doesn't get a form the server would refuse.
  useQuickActionParam('create', () => setCreateOpen(true), ready && canWrite);

  // Render the route's skeleton until hydrated; see useMounted.
  if (!mounted) return <Loading />;

  return (
    <>
      <PageHeader
        title="Storage"
        description="Buckets hold your files. Share private files with signed links."
      />
      {ready && !canWrite && <ReadOnlyNote>Your role can view buckets and files. Ask an owner or admin to make changes.</ReadOnlyNote>}
      <BucketList
        buckets={data?.buckets}
        loading={isLoading}
        error={!!error}
        onRetry={() => void refetch()}
        onCreate={canWrite ? () => setCreateOpen(true) : undefined}
        onDelete={canDelete ? setDeleting : undefined}
      />
      {canWrite && <CreateBucketDialog open={createOpen} onOpenChange={setCreateOpen} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        tone="destructive"
        title="Delete bucket"
        description={
          <>
            This permanently deletes <span className="font-semibold text-foreground">{deleting?.name}</span>. Only empty buckets can be
            deleted, so delete its files first.
          </>
        }
        confirmLabel="Delete bucket"
        requireText={deleting?.name}
        successToast={{ title: 'Bucket deleted', description: deleting?.name }}
        errorFallback="Could not delete the bucket. Try again."
        onConfirm={async () => {
          if (deleting) await deleteBucket.mutateAsync(deleting.id);
        }}
      />
    </>
  );
}
