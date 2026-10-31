'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable, RowActionsMenu, TableToolbar, type DataTableColumn } from '@/components/ui/data-table';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MenuItem, MenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RelativeTime } from '@/components/ui/relative-time';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/use-api-keys';
import { useQuickActionParam } from '@/hooks/use-quick-action-param';
import { errorMessage } from '@/lib/http';
import { scopesAllowedForRole } from '@/lib/rbac';
import type { ApiKey, CreatedApiKey, OrgRole } from '@/lib/types';
import { afterMenuClose } from '@/lib/after-menu-close';

const SCOPE_GROUP: Record<string, string> = {
  zone: 'Websites',
  cache: 'Cache',
  storage: 'Storage',
  analytics: 'Analytics',
  billing: 'Billing',
};

function groupScopes(scopes: string[]): { group: string; scopes: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const scope of scopes) {
    const group = SCOPE_GROUP[scope.split(':')[0]!] ?? 'Other';
    groups.set(group, [...(groups.get(group) ?? []), scope]);
  }
  return [...groups].map(([group, list]) => ({ group, scopes: list }));
}

function CreateKeyDialog({ role, open, onOpenChange }: { role: OrgRole; open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const createKey = useCreateApiKey();
  const allowed = scopesAllowedForRole(role);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = createKey.isPending;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      // The raw key is discarded as soon as the dialog closes.
      setName('');
      setSelected([]);
      setCreated(null);
      setNameError(null);
      setScopeError(null);
      setError(null);
    }
    onOpenChange(next);
  }

  function toggleScope(scope: string, checked: boolean) {
    setScopeError(null);
    setSelected((current) => (checked ? [...current, scope] : current.filter((s) => s !== scope)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim();
    const missingName = !trimmed;
    const missingScopes = selected.length === 0;
    setNameError(missingName ? 'Enter a name so you can recognise the key later.' : null);
    setScopeError(missingScopes ? 'Pick at least one scope.' : null);
    if (missingName || missingScopes) return;
    try {
      // Keep the order the scopes are listed in, whatever order they were ticked.
      const permissions = allowed.filter((s) => selected.includes(s));
      setCreated(await createKey.mutateAsync({ name: trimmed, permissions }));
      toast.success('API key created', trimmed);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the key. Try again.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent preventClose={pending}>
        {created ? (
          <>
            <DialogHeader className="flex-row items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <DialogTitle>API key created</DialogTitle>
                <DialogDescription>This key will not be shown again.</DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="API key"
                  readOnly
                  value={created.rawKey}
                  onFocus={(e) => e.target.select()}
                  className="font-mono text-xs"
                />
                <CopyButton value={created.rawKey} label="Copy key" size="icon" variant="secondary" />
              </div>
              <p className="flex items-start gap-2 rounded-[var(--radius)] border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Store it somewhere safe, like your CI secrets. If you lose it, revoke this key and create a new one.
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{created.name}</dd>
                <dt className="text-muted-foreground">Scopes</dt>
                <dd className="flex flex-wrap gap-1">
                  {created.permissions.map((p) => (
                    <Badge key={p} variant="secondary" className="font-mono">
                      {p}
                    </Badge>
                  ))}
                </dd>
              </dl>
            </DialogBody>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <DialogForm onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>Choose a name and the scopes this key may use. Your role limits which scopes you can grant.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label="Name" error={nameError} required>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder="github-actions"
                  autoComplete="off"
                  autoFocus
                />
              </Field>
              <fieldset className="flex flex-col gap-2" aria-describedby={scopeError ? 'scope-error' : undefined}>
                <div className="flex items-center justify-between">
                  <legend className="text-[13px] font-medium">Scopes</legend>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => {
                      setScopeError(null);
                      setSelected(selected.length === allowed.length ? [] : [...allowed]);
                    }}
                  >
                    {selected.length === allowed.length ? 'Clear all' : 'Select all'}
                  </Button>
                </div>
                <div className="grid gap-3 rounded-[var(--radius)] border border-border p-3 sm:grid-cols-2">
                  {groupScopes(allowed).map(({ group, scopes }) => (
                    <div key={group} className="flex flex-col gap-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                      {scopes.map((scope) => (
                        <Checkbox
                          key={scope}
                          label={<span className="font-mono text-[12px] font-normal">{scope}</span>}
                          checked={selected.includes(scope)}
                          onCheckedChange={(checked) => toggleScope(scope, checked)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {scopeError && (
                  <p id="scope-error" className="text-xs text-destructive">
                    {scopeError}
                  </p>
                )}
              </fieldset>
              {error && (
                <div role="alert" className="rounded-[var(--radius)] border border-destructive/40 bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
                  {error}
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" disabled={pending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" loading={pending}>
                Create key
              </Button>
            </DialogFooter>
          </DialogForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScopeList({ permissions }: { permissions: string[] }) {
  const shown = permissions.slice(0, 2);
  const rest = permissions.slice(2);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((p) => (
        <Badge key={p} variant="secondary" className="font-mono">
          {p}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip content={rest.join(', ')}>
          <button type="button" className="rounded-full">
            <Badge variant="outline">+{rest.length}</Badge>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export function ApiKeysPanel({ role, meId }: { role: string | null; meId: string }) {
  const toast = useToast();
  const { data: keys, isLoading, error, refetch } = useApiKeys();
  const revoke = useRevokeApiKey();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  // Owners and admins may revoke any key; everyone else only their own.
  const canRevokeAny = role === 'owner' || role === 'admin';
  const orgRole = (role ?? 'viewer') as OrgRole;
  useQuickActionParam('create', () => setCreateOpen(true), !!role);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (keys ?? []).filter((k) => !q || k.name.toLowerCase().includes(q) || k.keyPrefix.toLowerCase().includes(q));
  }, [keys, search]);

  async function copyPrefix(prefix: string) {
    try {
      await navigator.clipboard.writeText(prefix);
      toast.success('Key prefix copied', prefix);
    } catch {
      toast.error('Could not copy', 'Select the prefix and copy it manually.');
    }
  }

  const createButton = (
    <Button leftIcon={<Plus />} onClick={() => setCreateOpen(true)}>
      Create key
    </Button>
  );

  const columns: DataTableColumn<ApiKey>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (k) => (
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 truncate font-medium">
            {k.name}
            {k.userId === meId && <Badge variant="outline">Yours</Badge>}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">{k.keyPrefix}…</span>
        </div>
      ),
    },
    { id: 'scopes', header: 'Scopes', cell: (k) => <ScopeList permissions={k.permissions} />, hideBelow: 'md' },
    {
      id: 'lastUsed',
      header: 'Last used',
      cell: (k) => (k.lastUsedAt ? <RelativeTime value={k.lastUsedAt} className="text-muted-foreground" /> : <span className="text-muted-foreground">Never</span>),
      hideBelow: 'sm',
    },
    {
      id: 'expires',
      header: 'Expires',
      cell: (k) => (k.expiresAt ? <RelativeTime value={k.expiresAt} className="text-muted-foreground" /> : <span className="text-muted-foreground">Never</span>),
      align: 'right',
      hideBelow: 'lg',
    },
  ];

  return (
    <div className="flex flex-col">
      <DataTable
        aria-label="API keys"
        columns={columns}
        rows={filtered}
        getRowKey={(k) => k.id}
        loading={isLoading}
        error={error ? 'Could not load API keys.' : null}
        onRetry={() => void refetch()}
        toolbar={
          <TableToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search keys"
            count={keys ? filtered.length : undefined}
            noun="key"
            actions={createButton}
          />
        }
        empty={
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            description="Create a key to call the RivoCloud API from scripts and CI."
          />
        }
        emptyFiltered={search.trim() ? <EmptyState title="No matching keys" description="Try a different name or prefix." /> : undefined}
        rowActions={(k) => (
          <RowActionsMenu label={`Actions for ${k.name}`}>
            <MenuItem icon={<Copy />} onSelect={() => void copyPrefix(k.keyPrefix)}>
              Copy prefix
            </MenuItem>
            {(canRevokeAny || k.userId === meId) && (
              <>
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} tone="destructive" onSelect={() => afterMenuClose(() => setRevoking(k))}>
                  Revoke key…
                </MenuItem>
              </>
            )}
          </RowActionsMenu>
        )}
      />
      <CreateKeyDialog role={orgRole} open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        tone="destructive"
        title="Revoke key"
        description={
          <>
            Requests using <span className="font-semibold text-foreground">{revoking?.name}</span> (
            <span className="font-mono">{revoking?.keyPrefix}…</span>) will be refused straight away. This can&apos;t be undone.
          </>
        }
        confirmLabel="Revoke key"
        successToast={{ title: 'API key revoked', description: revoking?.name }}
        errorFallback="Could not revoke the key. Try again."
        onConfirm={async () => {
          if (revoking) await revoke.mutateAsync(revoking.id);
        }}
      />
    </div>
  );
}
