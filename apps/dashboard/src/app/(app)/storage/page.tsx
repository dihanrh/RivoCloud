'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { BucketList } from '@/components/storage/bucket-list';
import { CreateBucketDialog } from '@/components/storage/create-bucket-dialog';
import { useBuckets } from '@/hooks/use-buckets';

export default function StoragePage() {
  const { data, isLoading, error } = useBuckets();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Storage</h1>
        <CreateBucketDialog />
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && <p className="text-destructive">Failed to load buckets.</p>}
      {data && <BucketList buckets={data.buckets} />}
    </div>
  );
}
