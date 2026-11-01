'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, RowActionsMenu, type DataTableColumn } from '@/components/ui/data-table';
import { MenuItem, MenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionTitle } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { useCacheRules, useDeleteCacheRule, useReorderCacheRules } from '@/hooks/use-cache-rules';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { CacheRule } from '@/lib/types';
import { ACTION_LABEL, CacheRuleSheet, PATTERN_TYPE_LABEL, QUERY_STRING_LABEL } from './cache-rule-sheet';
import { formatTtl } from './format';

const ACTION_VARIANT = {
  cache: 'success',
  bypass: 'warning',
  'no-store': 'secondary',
} as const;

export function CacheRules({ zoneId }: { zoneId: string }) {
  const { data, isLoading, error, refetch } = useCacheRules(zoneId);
  const { canWrite, canDelete } = useZonePermissions();
  const toast = useToast();
  const reorder = useReorderCacheRules(zoneId);
  const remove = useDeleteCacheRule(zoneId);
  const [editing, setEditing] = useState<CacheRule | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  // Kept after close so the dialog text doesn't blank out during its exit animation.
  const [deleting, setDeleting] = useState<CacheRule | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const rules = data?.rules ?? [];
  // A new rule goes to the bottom of the list: one below the lowest priority.
  const newPriority = rules.length > 0 ? Math.min(...rules.map((r) => r.priority)) - 1 : 0;

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }

  async function move(rule: CacheRule, delta: -1 | 1) {
    const order = rules.map((r) => r.id);
    const index = order.indexOf(rule.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    try {
      await reorder.mutateAsync(order);
      toast.success(delta < 0 ? 'Rule moved up' : 'Rule moved down', `${rule.pattern} is now rule ${target + 1}.`);
    } catch (err) {
      toast.error('Could not reorder the cache rules', errorMessage(err, 'Try again in a moment.'));
    }
  }

  const columns: DataTableColumn<CacheRule>[] = [
    {
      id: 'order',
      header: '#',
      width: '3rem',
      className: 'tabular-nums text-muted-foreground',
      cell: (rule) => rules.indexOf(rule) + 1,
    },
    {
      id: 'pattern',
      header: 'Pattern',
      className: 'min-w-48',
      cell: (rule) => (
        <div className="flex flex-col">
          <span className="break-all font-mono text-[13px]">{rule.pattern}</span>
          <span className="text-xs text-muted-foreground">{PATTERN_TYPE_LABEL[rule.patternType] ?? rule.patternType}</span>
        </div>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (rule) => (
        <Badge variant={ACTION_VARIANT[rule.action] ?? 'secondary'}>{ACTION_LABEL[rule.action] ?? rule.action}</Badge>
      ),
    },
    {
      id: 'edge',
      header: 'Edge TTL',
      hideBelow: 'sm',
      className: 'whitespace-nowrap',
      cell: (rule) => (rule.action === 'cache' ? formatTtl(rule.edgeTtl) : '—'),
    },
    {
      id: 'browser',
      header: 'Browser TTL',
      hideBelow: 'md',
      className: 'whitespace-nowrap',
      cell: (rule) => (rule.action === 'cache' ? formatTtl(rule.browserTtl) : '—'),
    },
    {
      id: 'query',
      header: 'Query string',
      hideBelow: 'lg',
      cell: (rule) => (
        <div className="flex flex-col">
          <span>{QUERY_STRING_LABEL[rule.queryString] ?? rule.queryString}</span>
          {rule.queryString === 'whitelist' && rule.queryWhitelist.length > 0 && (
            <span className="font-mono text-xs text-muted-foreground">{rule.queryWhitelist.join(', ')}</span>
          )}
        </div>
      ),
    },
  ];

  const rowActions =
    canWrite || canDelete
      ? (rule: CacheRule) => {
          const index = rules.indexOf(rule);
          return (
            <RowActionsMenu label={`Actions for ${rule.pattern}`}>
              <>
                {canWrite && (
                  <>
                    <MenuItem
                      icon={<Pencil />}
                      onSelectAfterClose={() => {
                        setEditing(rule);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </MenuItem>
                    <MenuItem
                      icon={<ArrowUp />}
                      disabled={index === 0 || reorder.isPending}
                      onSelect={() => void move(rule, -1)}
                    >
                      Move up
                    </MenuItem>
                    <MenuItem
                      icon={<ArrowDown />}
                      disabled={index === rules.length - 1 || reorder.isPending}
                      onSelect={() => void move(rule, 1)}
                    >
                      Move down
                    </MenuItem>
                  </>
                )}
                {canDelete && (
                  <>
                    {canWrite && <MenuSeparator />}
                    <MenuItem
                      icon={<Trash2 />}
                      tone="destructive"
                      onSelectAfterClose={() => {
                        setDeleting(rule);
                        setDeleteOpen(true);
                      }}
                    >
                      Delete…
                    </MenuItem>
                  </>
                )}
              </>
            </RowActionsMenu>
          );
        }
      : undefined;

  return (
    <section aria-labelledby="cache-rules-title">
      <SectionTitle
        actions={
          canWrite ? (
            <Button size="sm" leftIcon={<Plus />} onClick={openCreate}>
              Create rule
            </Button>
          ) : undefined
        }
      >
        <span id="cache-rules-title">Cache rules</span>
      </SectionTitle>
      <p className="-mt-1 mb-3 text-[13px] text-muted-foreground">
        Override caching for specific paths. Rules run from top to bottom and the first match wins.
      </p>

      <DataTable
        aria-label="Cache rules"
        columns={columns}
        rows={rules}
        getRowKey={(rule) => rule.id}
        loading={isLoading}
        skeletonRows={3}
        error={error ? 'Could not load cache rules.' : null}
        onRetry={() => void refetch()}
        rowActions={rowActions}
        empty={
          <EmptyState
            className="py-8"
            icon={Zap}
            title="No cache rules"
            description="Every path uses the website's default TTLs. Add a rule to cache, bypass, or skip storing specific paths."
            action={
              canWrite ? (
                <Button size="sm" variant="secondary" leftIcon={<Plus />} onClick={openCreate}>
                  Create rule
                </Button>
              ) : undefined
            }
          />
        }
      />

      <CacheRuleSheet zoneId={zoneId} rule={editing} open={formOpen} onOpenChange={setFormOpen} newPriority={newPriority} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="destructive"
        title="Delete cache rule"
        description={
          <>
            Requests matching <span className="font-mono text-foreground">{deleting?.pattern}</span> fall back to the next
            matching rule or the website defaults.
          </>
        }
        confirmLabel="Delete rule"
        successToast="Cache rule deleted"
        errorFallback="Could not delete the cache rule."
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id);
        }}
      />
    </section>
  );
}
