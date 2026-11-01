import { Skeleton } from '@/components/ui/skeleton';
import { SettingsTableSkeleton } from '@/components/settings/settings-gate';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading page">
      <div className="mb-6 flex flex-col gap-3">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>
      <SettingsTableSkeleton />
    </div>
  );
}
