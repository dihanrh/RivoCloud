'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/use-api-keys';
import { scopesAllowedForRole } from '@/lib/rbac';
import { errorMessage } from '@/lib/http';
import type { CreatedApiKey, OrgRole } from '@/lib/types';

function CreateKeyDialog({ role }: { role: OrgRole }) {
  const createKey = useCreateApiKey();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // The raw key is discarded as soon as the dialog closes.
      setName('');
      setSelected([]);
      setCreated(null);
      setCopied(false);
      setError(null);
    }
  }

  function toggleScope(scope: string, checked: boolean) {
    setSelected((current) => (checked ? [...current, scope] : current.filter((s) => s !== scope)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setCreated(await createKey.mutateAsync({ name, permissions: selected }));
    } catch (err) {
      setError(errorMessage(err, 'Could not create the key. Try again.'));
    }
  }

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.rawKey);
      setCopied(true);
    } catch {
      setError('Copy failed. Select the key and copy it manually.');
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Create key</Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>API key created</DialogTitle>
                <DialogDescription>This key will not be shown again.</DialogDescription>
              </DialogHeader>
              <div className="flex gap-2">
                <Input aria-label="API key" readOnly value={created.rawKey} onFocus={(e) => e.target.select()} />
                <Button type="button" variant="outline" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {error && <p role="alert" className="mt-2 text-[13px] text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>Choose a name and the scopes this key may use.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-[13px] font-medium">Scopes</legend>
                {scopesAllowedForRole(role).map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selected.includes(scope)}
                      onChange={(e) => toggleScope(scope, e.target.checked)}
                    />
                    {scope}
                  </label>
                ))}
              </fieldset>
              {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="submit" disabled={createKey.isPending || selected.length === 0}>
                  {createKey.isPending ? 'Creating…' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ApiKeysPanel({ role, meId }: { role: string | null; meId: string }) {
  const { data: keys, isLoading, error } = useApiKeys();
  const revoke = useRevokeApiKey();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleRevoke(keyId: string) {
    setMessage(null);
    try {
      await revoke.mutateAsync(keyId);
    } catch (err) {
      setMessage(errorMessage(err, 'Could not revoke the key. Try again.'));
    } finally {
      setConfirmingId(null);
    }
  }

  // Owners and admins may revoke any key; everyone else only their own.
  const canRevokeAny = role === 'owner' || role === 'admin';
  const orgRole = (role ?? 'viewer') as OrgRole;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <CreateKeyDialog role={orgRole} />
      </div>
      {message && <ErrorBanner>{message}</ErrorBanner>}
      {isLoading && <Skeleton className="h-32 w-full" />}
      {error && <ErrorBanner>Could not load API keys. Refresh the page to try again.</ErrorBanner>}
      {keys && keys.length === 0 && (
        <Card>
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            description="Create a key to call the RivoCloud API from scripts and CI."
          />
        </Card>
      )}
      {keys && keys.length > 0 && (
        <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.name}</TableCell>
                <TableCell className="font-mono text-xs">{key.keyPrefix}…</TableCell>
                <TableCell>{key.permissions.join(', ')}</TableCell>
                <TableCell className="text-muted-foreground">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {!canRevokeAny && key.userId !== meId ? null : confirmingId === key.id ? (
                    <span className="inline-flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={() => void handleRevoke(key.id)}
                      >
                        Confirm revoke
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Revoke ${key.name}`}
                      onClick={() => setConfirmingId(key.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </Card>
      )}
    </div>
  );
}
