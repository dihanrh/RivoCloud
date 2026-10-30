'use client';

import { useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionTitle } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createDomainSchema } from '@/lib/validation';
import { useDomains } from '@/hooks/use-domains';
import { useCreateDomain } from '@/hooks/use-create-domain';
import { useDeleteDomain } from '@/hooks/use-delete-domain';
import { useVerifyDomain } from '@/hooks/use-verify-domain';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { ZoneDomain } from '@/lib/types';
import { CopyButton } from './copy-button';

export const SSL_STATUS: Record<ZoneDomain['sslStatus'], { label: string; variant: 'warning' | 'success' | 'destructive' }> = {
  pending_dns: { label: 'Waiting for DNS', variant: 'warning' },
  pending_ssl: { label: 'Issuing certificate', variant: 'warning' },
  active: { label: 'Active', variant: 'success' },
  error: { label: 'Error', variant: 'destructive' },
};

/** Custom domains for a website: CNAME instructions, list, add, verify, remove. */
export function ZoneDomains({ zoneId }: { zoneId: string }) {
  const { data: domains, isLoading, error } = useDomains(zoneId);
  const { canWrite, canDelete } = useZonePermissions();
  const verifyDomain = useVerifyDomain(zoneId);
  const deleteDomain = useDeleteDomain(zoneId);
  const [removing, setRemoving] = useState<ZoneDomain | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);

  const cnameTarget = domains?.[0]?.cnameTarget;

  async function verify(domain: ZoneDomain) {
    setActionError(null);
    try {
      await verifyDomain.mutateAsync(domain.id);
    } catch (err) {
      setActionError(errorMessage(err, `Could not check ${domain.domain}. Try again in a minute.`));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Point your domain at the edge</CardTitle>
          <CardDescription>
            At your DNS provider, create a CNAME record for each custom domain. Then select Check DNS. We issue a TLS
            certificate as soon as the record resolves.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border text-[13px] sm:grid-cols-3">
            <div className="bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">Type</p>
              <p className="font-mono">CNAME</p>
            </div>
            <div className="bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="font-mono">Your custom domain</p>
            </div>
            <div className="bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">Target</p>
              {cnameTarget ? (
                <p className="flex items-center gap-1 font-mono">
                  <span className="break-all">{cnameTarget}</span>
                  <CopyButton value={cnameTarget} label="Copy CNAME target" />
                </p>
              ) : (
                <p className="text-muted-foreground">Shown after you add a domain</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <section>
        <SectionTitle actions={canWrite ? <AddDomainDialog zoneId={zoneId} /> : undefined}>Custom domains</SectionTitle>
        {actionError && (
          <div className="mb-3">
            <ErrorBanner>{actionError}</ErrorBanner>
          </div>
        )}
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <ErrorBanner>Could not load custom domains. Refresh the page to try again.</ErrorBanner>
        ) : (
          <Card>
            {!domains?.length ? (
              <EmptyState
                icon={Link2}
                title="No custom domains yet"
                description="Serve this website from a hostname you own, such as cdn.your-company.com."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Certificate</TableHead>
                    <TableHead>CNAME target</TableHead>
                    {(canWrite || canDelete) && (
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((d) => {
                    const status = SSL_STATUS[d.sslStatus] ?? { label: d.sslStatus, variant: 'warning' as const };
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="min-w-48">
                          <span className="font-medium">{d.domain}</span>
                          {d.sslStatus === 'error' && d.sslError && (
                            <p className="mt-0.5 text-xs text-destructive">{d.sslError}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {d.sslStatus === 'active' && d.certExpiresAt && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Renews before {new Date(d.certExpiresAt).toLocaleDateString()}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="break-all font-mono text-xs">{d.cnameTarget}</TableCell>
                        {(canWrite || canDelete) && (
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              {canWrite && d.sslStatus !== 'active' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => verify(d)}
                                  disabled={verifyDomain.isPending}
                                  aria-label={`Check DNS for ${d.domain}`}
                                >
                                  Check DNS
                                </Button>
                              )}
                              {canDelete && (
                                <Button variant="ghost" size="sm" onClick={() => setRemoving(d)} aria-label={`Remove ${d.domain}`}>
                                  Remove
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        )}
      </section>

      <Dialog
        open={Boolean(removing)}
        onOpenChange={(next) => {
          if (!next) setRemoving(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.domain}?</DialogTitle>
            <DialogDescription>
              The edge stops serving this website on {removing?.domain} and its certificate is no longer renewed. Remove the
              CNAME record at your DNS provider too.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteDomain.isPending}
              onClick={async () => {
                if (!removing) return;
                setActionError(null);
                try {
                  await deleteDomain.mutateAsync(removing.id);
                } catch (err) {
                  setActionError(errorMessage(err, `Could not remove ${removing.domain}.`));
                }
                setRemoving(undefined);
              }}
            >
              {deleteDomain.isPending ? 'Removing…' : 'Remove domain'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddDomainDialog({ zoneId }: { zoneId: string }) {
  const createDomain = useCreateDomain(zoneId);
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setDomain('');
      setError(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createDomainSchema.safeParse({ domain: domain.trim().toLowerCase() });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid hostname.');
      return;
    }
    try {
      await createDomain.mutateAsync(parsed.data);
      handleOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not add the domain.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add domain
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a custom domain</DialogTitle>
          <DialogDescription>Enter a hostname you control. You will point it at the edge with a CNAME record.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-domain">Domain</Label>
            <Input
              id="new-domain"
              placeholder="cdn.your-company.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createDomain.isPending}>
              {createDomain.isPending ? 'Adding…' : 'Add domain'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
