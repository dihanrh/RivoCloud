'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { SectionTitle } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCacheRules, useDeleteCacheRule, useReorderCacheRules } from '@/hooks/use-cache-rules';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { CacheRule } from '@/lib/types';
import { ACTION_LABEL, CacheRuleDialog, PATTERN_TYPE_LABEL, QUERY_STRING_LABEL } from './cache-rule-dialog';
import { formatTtl } from './format';

const ACTION_VARIANT = { cache: 'success', bypass: 'warning', 'no-store': 'secondary' } as const;

export function CacheRules({ zoneId }: { zoneId: string }) {
  const { data, isLoading, error } = useCacheRules(zoneId);
  const { canWrite, canDelete } = useZonePermissions();
  const reorder = useReorderCacheRules(zoneId);
  const [editing, setEditing] = useState<CacheRule | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<CacheRule | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);

  const rules = data?.rules ?? [];
  // A new rule goes to the bottom of the list: one below the lowest priority.
  const newPriority = rules.length > 0 ? Math.min(...rules.map((r) => r.priority)) - 1 : 0;

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }

  async function move(index: number, delta: -1 | 1) {
    const order = rules.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setActionError(null);
    try {
      await reorder.mutateAsync(order);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not reorder the cache rules.'));
    }
  }

  return (
    <section>
      <SectionTitle
        actions={
          canWrite ? (
            <Button size="sm" onClick={openCreate}>
              <Plus /> Create rule
            </Button>
          ) : undefined
        }
      >
        Cache rules
      </SectionTitle>
      <p className="-mt-1 mb-3 text-[13px] text-muted-foreground">
        Override caching for specific paths. Rules run from top to bottom and the first match wins.
      </p>

      {actionError && (
        <div className="mb-3">
          <ErrorBanner>{actionError}</ErrorBanner>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : error ? (
        <ErrorBanner>Could not load cache rules. Refresh the page to try again.</ErrorBanner>
      ) : (
        <Card>
          {rules.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No cache rules"
              description="Every path uses the website's default TTLs. Add a rule to cache, bypass, or skip storing specific paths."
              action={
                canWrite ? (
                  <Button size="sm" variant="outline" onClick={openCreate}>
                    Create rule
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Order</TableHead>
                  <TableHead>Pattern</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Edge TTL</TableHead>
                  <TableHead>Browser TTL</TableHead>
                  <TableHead>Query string</TableHead>
                  {(canWrite || canDelete) && (
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule, index) => (
                  <TableRow key={rule.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="min-w-48">
                      <span className="break-all font-mono text-[13px]">{rule.pattern}</span>
                      <p className="text-xs text-muted-foreground">{PATTERN_TYPE_LABEL[rule.patternType] ?? rule.patternType}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ACTION_VARIANT[rule.action] ?? 'secondary'}>{ACTION_LABEL[rule.action] ?? rule.action}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{rule.action === 'cache' ? formatTtl(rule.edgeTtl) : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{rule.action === 'cache' ? formatTtl(rule.browserTtl) : '—'}</TableCell>
                    <TableCell>
                      {QUERY_STRING_LABEL[rule.queryString] ?? rule.queryString}
                      {rule.queryString === 'whitelist' && rule.queryWhitelist.length > 0 && (
                        <p className="font-mono text-xs text-muted-foreground">{rule.queryWhitelist.join(', ')}</p>
                      )}
                    </TableCell>
                    {(canWrite || canDelete) && (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {canWrite && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Move ${rule.pattern} up`}
                                disabled={index === 0 || reorder.isPending}
                                onClick={() => move(index, -1)}
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Move ${rule.pattern} down`}
                                disabled={index === rules.length - 1 || reorder.isPending}
                                onClick={() => move(index, 1)}
                              >
                                <ArrowDown />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit ${rule.pattern}`}
                                onClick={() => {
                                  setEditing(rule);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil />
                              </Button>
                            </>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="icon" aria-label={`Delete ${rule.pattern}`} onClick={() => setDeleting(rule)}>
                              <Trash2 className="text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <CacheRuleDialog
        zoneId={zoneId}
        rule={editing}
        open={formOpen}
        onOpenChange={setFormOpen}
        newPriority={newPriority}
      />
      <DeleteRuleDialog zoneId={zoneId} rule={deleting} onClose={() => setDeleting(undefined)} />
    </section>
  );
}

function DeleteRuleDialog({ zoneId, rule, onClose }: { zoneId: string; rule?: CacheRule; onClose: () => void }) {
  const remove = useDeleteCacheRule(zoneId);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!rule) return;
    setError(null);
    try {
      await remove.mutateAsync(rule.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the cache rule.'));
    }
  }

  return (
    <Dialog
      open={Boolean(rule)}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete cache rule?</DialogTitle>
          <DialogDescription>
            Requests matching <span className="font-mono">{rule?.pattern}</span> fall back to the next matching rule or the
            website defaults.
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
