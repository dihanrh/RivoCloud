'use client';

import { useAnalyticsGeography } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function GeographyTable({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsGeography(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const countries = data?.countries ?? [];

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="pb-2">Country</th>
          <th className="pb-2">Requests</th>
        </tr>
      </thead>
      <tbody>
        {countries.map((row) => (
          <tr key={row.country}>
            <td className="py-1">{row.country}</td>
            <td className="py-1">{row.requests.toLocaleString()}</td>
          </tr>
        ))}
        {countries.length === 0 && (
          <tr>
            <td colSpan={2} className="py-4 text-muted-foreground">
              No data for this range.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
