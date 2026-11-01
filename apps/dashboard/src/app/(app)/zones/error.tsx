'use client';

import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

/** Unexpected render error on the websites list. */
export default function ZonesError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <PageHeader title="Websites" />
      <div className="flex flex-col items-start gap-3">
        <ErrorBanner>Something went wrong while showing your websites.</ErrorBanner>
        <Button variant="secondary" size="sm" leftIcon={<RotateCw />} onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
