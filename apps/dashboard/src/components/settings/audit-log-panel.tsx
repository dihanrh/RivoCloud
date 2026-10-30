'use client';

import { ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuditLogs } from '@/hooks/use-audit-logs';
import type { AuditLogEntry } from '@/lib/types';

function actorLabel(entry: AuditLogEntry): string {
  // API-key actions also record the key's creator as `user`, so the key wins.
  if (entry.apiKey) {
    const key = `API key ${entry.apiKey.keyPrefix}…`;
    return entry.user ? `${key} (by ${entry.user.email})` : key;
  }
  if (entry.user) return entry.user.email;
  return 'System';
}

function resourceLabel(entry: AuditLogEntry): string {
  return [entry.resourceType, entry.resourceId].filter(Boolean).join(' ') || '—';
}

export function AuditLogPanel({ orgId }: { orgId: string }) {
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useAuditLogs(orgId);
  const entries = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {isLoading && <Skeleton className="h-32 w-full" />}
      {error && <ErrorBanner>Could not load the audit log. Refresh the page to try again.</ErrorBanner>}
      {data && entries.length === 0 && (
        <Card>
          <EmptyState
            icon={ScrollText}
            title="No audit events yet"
            description="Changes to websites, buckets, members and API keys will show up here."
          />
        </Card>
      )}
      {entries.length > 0 && (
        <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</TableCell>
                <TableCell>{actorLabel(entry)}</TableCell>
                <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                <TableCell>{resourceLabel(entry)}</TableCell>
                <TableCell>{entry.ipAddress ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </Card>
      )}
      {hasNextPage && (
        <div>
          <Button variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
