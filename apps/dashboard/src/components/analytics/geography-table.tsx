'use client';

import { useAnalyticsGeography } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function GeographyTable({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsGeography(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const countries = data?.countries ?? [];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Country</TableHead>
          <TableHead className="text-right">Requests</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {countries.map((row) => (
          <TableRow key={row.country}>
            <TableCell>{row.country}</TableCell>
            <TableCell className="text-right tabular-nums">{row.requests.toLocaleString()}</TableCell>
          </TableRow>
        ))}
        {countries.length === 0 && (
          <TableRow>
            <TableCell colSpan={2} className="py-6 text-muted-foreground">
              No data for this range.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
