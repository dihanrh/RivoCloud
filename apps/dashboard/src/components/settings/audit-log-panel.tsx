'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuditLogs } from '@/hooks/use-audit-logs';
import type { AuditLogEntry } from '@/lib/types';

function actorLabel(entry: AuditLogEntry): string {
  // API-key actions also record the key's creator as `user`, so the key wins.
  if (entry.apiKey) {
    const key = `API key ${entry.apiKey.keyPrefix}�`;
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
      {error && <p className="text-destructive">Failed to load the audit log.</p>}
      {data && entries.length === 0 && <p className="text-sm text-muted-foreground">No audit events yet.</p>}
      {entries.length > 0 && (
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
                <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                <TableCell>{actorLabel(entry)}</TableCell>
                <TableCell className="font-mono">{entry.action}</TableCell>
                <TableCell>{resourceLabel(entry)}</TableCell>
                <TableCell>{entry.ipAddress ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
