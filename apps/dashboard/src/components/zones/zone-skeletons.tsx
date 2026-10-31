import { Card } from '@/components/ui/card';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';

/** Header placeholder: crumbs, title + description, an action on the right. */
function HeaderSkeleton({ crumbs = true, action = true }: { crumbs?: boolean; action?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      {crumbs && <Skeleton className="h-3.5 w-40" />}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
        {action && <Skeleton className="hidden h-9 w-32 sm:block" />}
      </div>
    </div>
  );
}

/** The websites list while it loads: header, toolbar, and table rows. */
export function WebsitesSkeleton() {
  return (
    <div role="status" aria-label="Loading websites">
      <HeaderSkeleton crumbs={false} action={false} />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <Skeleton className="h-8 w-full sm:w-72" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="ml-auto hidden h-8 w-32 sm:block" />
        </div>
        <div className="border-t border-border">
          <TableSkeleton rows={6} columns={6} />
        </div>
      </Card>
    </div>
  );
}

/** Any page under one website: header, a strip of tiles, then setting rows. */
export function ZonePageSkeleton() {
  return (
    <div role="status" aria-label="Loading website">
      <HeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-20" />
          </Card>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-4">
        {[0, 1].map((i) => (
          <Card key={i} className="flex flex-col gap-4 p-5 md:flex-row md:justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-96 max-w-full" />
            </div>
            <Skeleton className="h-9 w-full md:w-64" />
          </Card>
        ))}
      </div>
    </div>
  );
}
