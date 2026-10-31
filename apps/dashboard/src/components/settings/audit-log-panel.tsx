'use client';

import { useMemo, useState } from 'react';
import { Bot, KeyRound, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, TableToolbar, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/input';
import { RelativeTime } from '@/components/ui/relative-time';
import { useAuditLogs } from '@/hooks/use-audit-logs';
import { formatNumber } from '@/lib/format';
import type { AuditLogEntry } from '@/lib/types';
import { UserAvatar } from './user-avatar';

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

/** "zone.created" → "zone"; used for the action filter. */
function actionGroup(action: string): string {
  return action.split('.')[0] ?? action;
}

function Actor({ entry }: { entry: AuditLogEntry }) {
  const icon = entry.apiKey ? (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
      <KeyRound className="h-3.5 w-3.5" />
    </span>
  ) : entry.user ? (
    <UserAvatar name={entry.user.name} email={entry.user.email} className="h-7 w-7 text-[10px]" />
  ) : (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
      <Bot className="h-3.5 w-3.5" />
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {icon}
      <span className="min-w-0 truncate">{actorLabel(entry)}</span>
    </div>
  );
}

export function AuditLogPanel({ orgId }: { orgId: string }) {
  const { data, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useAuditLogs(orgId);
  const [action, setAction] = useState('all');
  const [search, setSearch] = useState('');
  const entries = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  const groups = useMemo(() => [...new Set(entries.map((e) => actionGroup(e.action)))].sort(), [entries]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (action === 'all' || actionGroup(e.action) === action) &&
        (!q || [e.action, actorLabel(e), resourceLabel(e), e.ipAddress ?? ''].some((s) => s.toLowerCase().includes(q))),
    );
  }, [entries, action, search]);
  const filtering = action !== 'all' || search.trim() !== '';

  const columns: DataTableColumn<AuditLogEntry>[] = [
    {
      id: 'time',
      header: 'Time',
      width: '9rem',
      cell: (e) => <RelativeTime value={e.createdAt} className="whitespace-nowrap text-muted-foreground" />,
    },
    { id: 'actor', header: 'Actor', cell: (e) => <Actor entry={e} />, className: 'max-w-72' },
    {
      id: 'action',
      header: 'Action',
      cell: (e) => <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{e.action}</span>,
    },
    {
      id: 'resource',
      header: 'Resource',
      // Long IDs (UUIDs) are shortened to their first 8 characters; the full value is in the title.
      cell: (e) =>
        e.resourceId && e.resourceId.length > 12 ? (
          <span title={resourceLabel(e)}>
            {e.resourceType} <span className="font-mono text-xs text-muted-foreground">{e.resourceId.slice(0, 8)}</span>
          </span>
        ) : (
          <span className="break-all">{resourceLabel(e)}</span>
        ),
      hideBelow: 'md',
    },
    { id: 'ip', header: 'IP', cell: (e) => <span className="font-mono text-xs text-muted-foreground">{e.ipAddress ?? '—'}</span>, hideBelow: 'lg' },
  ];

  return (
    <DataTable
      aria-label="Audit log"
      columns={columns}
      rows={filtered}
      getRowKey={(e) => e.id}
      // Only the first page shows skeletons; later pages append below so the scroll position holds.
      loading={isLoading}
      skeletonRows={8}
      error={error ? 'Could not load the audit log.' : null}
      onRetry={() => void refetch()}
      toolbar={
        <TableToolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search events"
          count={data ? filtered.length : undefined}
          noun="event"
          filters={
            <Select aria-label="Action" className="h-8 w-auto min-w-36 text-[13px]" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="all">All actions</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}.*
                </option>
              ))}
            </Select>
          }
        />
      }
      empty={
        <EmptyState
          icon={ScrollText}
          title="No audit events yet"
          description="Changes to websites, buckets, members and API keys will show up here."
        />
      }
      emptyFiltered={
        filtering ? (
          <EmptyState
            title="No matching events"
            description={hasNextPage ? 'Only loaded events are searched. Load more to look further back.' : 'Try a different action or search.'}
          />
        ) : undefined
      }
      footer={
        data && entries.length > 0 ? (
          <div className="flex items-center justify-between gap-3">
            <span>
              {hasNextPage ? `Showing the latest ${formatNumber(entries.length)} events` : `All ${formatNumber(entries.length)} events loaded`}
            </span>
            {hasNextPage && (
              <Button variant="secondary" size="sm" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                Load more
              </Button>
            )}
          </div>
        ) : undefined
      }
    />
  );
}
