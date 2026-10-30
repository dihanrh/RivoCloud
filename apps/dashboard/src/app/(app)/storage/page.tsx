'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { BucketList } from '@/components/storage/bucket-list';
import { CreateBucketDialog } from '@/components/storage/create-bucket-dialog';
import { useBuckets } from '@/hooks/use-buckets';

export default function StoragePage() {
  const { data, isLoading, error } = useBuckets();

  return (
    <>
      <PageHeader
        title="Storage"
        description="Buckets hold your files. Share private files with signed links."
        actions={data && data.buckets.length > 0 ? <CreateBucketDialog /> : undefined}
      />
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <ErrorBanner>Could not load your buckets. Refresh the page to try again.</ErrorBanner>}
      {data && <BucketList buckets={data.buckets} action={<CreateBucketDialog />} />}
    </>
  );
}
