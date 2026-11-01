'use client';

import { useState } from 'react';
import { Copy, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable, RowActionsMenu, type DataTableColumn } from '@/components/ui/data-table';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { MenuItem, MenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorBanner } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/page-header';
import { RelativeTime } from '@/components/ui/relative-time';
import { useToast } from '@/components/ui/toast';
import { useCreateDomain } from '@/hooks/use-create-domain';
import { useDeleteDomain } from '@/hooks/use-delete-domain';
import { useDomains } from '@/hooks/use-domains';
import { useVerifyDomain } from '@/hooks/use-verify-domain';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { formatDate } from '@/lib/format';
import { errorMessage } from '@/lib/http';
import type { Zone, ZoneDomain } from '@/lib/types';
import { createDomainSchema } from '@/lib/validation';
import { copyToClipboard } from './menu-helpers';
import { ReadOnlyNote, ZoneHeader } from './zone-shell';

export const SSL_STATUS: Record<ZoneDomain['sslStatus'], { label: string; variant: 'warning' | 'success' | 'destructive' }> = {
  pending_dns: { label: 'Waiting for DNS', variant: 'warning' },
  pending_ssl: { label: 'Issuing certificate', variant: 'warning' },
  active: { label: 'Active', variant: 'success' },
  error: { label: 'Error', variant: 'destructive' },
};

/** The website's Custom domains page: CNAME instructions, list, add, verify, delete. */
export function ZoneDomains({ zone }: { zone: Zone }) {
  const zoneId = zone.id;
  const { data: domains, isLoading, error, refetch } = useDomains(zoneId);
  const { canWrite, canDelete } = useZonePermissions();
  const toast = useToast();
  const verifyDomain = useVerifyDomain(zoneId);
  const deleteDomain = useDeleteDomain(zoneId);
  const [removing, setRemoving] = useState<ZoneDomain | undefined>();
  const [removeOpen, setRemoveOpen] = useState(false);

  const cnameTarget = domains?.[0]?.cnameTarget;

  async function verify(domain: ZoneDomain) {
    const id = toast.info(`Checking ${domain.domain}…`, undefined, {
      duration: Infinity,
    });
    try {
      const result = await verifyDomain.mutateAsync(domain.id);
      toast.dismiss(id);
      const status = result?.sslStatus ?? domain.sslStatus;
      if (status === 'pending_dns') {
        toast.info(
          'DNS record not found yet',
          `Point a CNAME for ${domain.domain} at ${domain.cnameTarget}. Changes can take a few minutes to spread.`,
        );
      } else if (status === 'error') {
        toast.error(`Could not verify ${domain.domain}`, result?.sslError ?? 'The certificate could not be issued.');
      } else {
        toast.success(
          'Domain verified',
          status === 'active' ? `${domain.domain} is live.` : `Issuing a certificate for ${domain.domain}.`,
        );
      }
    } catch (err) {
      toast.dismiss(id);
      toast.error(`Could not check ${domain.domain}`, errorMessage(err, 'Try again in a minute.'));
    }
  }

  const columns: DataTableColumn<ZoneDomain>[] = [
    {
      id: 'domain',
      header: 'Domain',
      className: 'min-w-48',
      cell: (d) => (
        <div className="flex flex-col">
          <span className="font-semibold">{d.domain}</span>
          {d.sslStatus === 'error' && d.sslError && <span className="mt-0.5 text-xs text-destructive">{d.sslError}</span>}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Certificate',
      cell: (d) => {
        const status = SSL_STATUS[d.sslStatus] ?? {
          label: d.sslStatus,
          variant: 'warning' as const,
        };
        return (
          <div className="flex flex-col items-start gap-0.5">
            <Badge variant={status.variant}>{status.label}</Badge>
            {d.sslStatus === 'active' && d.certExpiresAt && (
              <span className="text-xs text-muted-foreground">Renews before {formatDate(d.certExpiresAt)}</span>
            )}
          </div>
        );
      },
    },
    {
      id: 'cname',
      header: 'CNAME target',
      hideBelow: 'md',
      cell: (d) => <span className="break-all font-mono text-xs">{d.cnameTarget}</span>,
    },
    {
      id: 'added',
      header: 'Added',
      hideBelow: 'lg',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (d) => <RelativeTime value={d.createdAt} />,
    },
  ];

  return (
    <div>
      <ZoneHeader
        zone={zone}
        section="Custom domains"
        description="Serve this website from hostnames you own. Certificates are issued and renewed automatically."
        actions={canWrite ? <AddDomainDialog zoneId={zoneId} /> : !canDelete ? <ReadOnlyNote /> : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle>Point your domain at the edge</CardTitle>
          <CardDescription>
            At your DNS provider, create a CNAME record for each custom domain, then choose Verify now from its menu. We issue a
            TLS certificate as soon as the record resolves.
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

      <SectionTitle>Domains</SectionTitle>
      <DataTable
        aria-label="Custom domains"
        columns={columns}
        rows={domains}
        getRowKey={(d) => d.id}
        loading={isLoading}
        skeletonRows={3}
        error={error ? 'Could not load custom domains.' : null}
        onRetry={() => void refetch()}
        empty={
          <EmptyState
            className="py-8"
            icon={Link2}
            title="No custom domains yet"
            description="Serve this website from a hostname you own, such as cdn.your-company.com."
            action={canWrite ? <AddDomainDialog zoneId={zoneId} variant="secondary" /> : undefined}
          />
        }
        rowActions={(d) => (
          <RowActionsMenu label={`Actions for ${d.domain}`}>
            <>
              {canWrite && (
                <MenuItem icon={<RefreshCw />} disabled={verifyDomain.isPending} onSelect={() => void verify(d)}>
                  Verify now
                </MenuItem>
              )}
              <MenuItem
                icon={<Copy />}
                onSelect={() =>
                  void copyToClipboard(d.cnameTarget, toast, {
                    success: 'CNAME target copied',
                    description: d.cnameTarget,
                  })
                }
              >
                Copy CNAME target
              </MenuItem>
              {canDelete && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Trash2 />}
                    tone="destructive"
                    onSelectAfterClose={() => {
                      setRemoving(d);
                      setRemoveOpen(true);
                    }}
                  >
                    Delete…
                  </MenuItem>
                </>
              )}
            </>
          </RowActionsMenu>
        )}
      />

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        tone="destructive"
        title="Delete domain"
        description={
          <>
            The edge stops serving this website on <b className="font-semibold text-foreground">{removing?.domain}</b> and its
            certificate is no longer renewed. Remove the CNAME record at your DNS provider too.
          </>
        }
        confirmLabel="Delete domain"
        successToast={{
          title: 'Domain deleted',
          description: removing?.domain,
        }}
        errorFallback="Could not delete the domain."
        onConfirm={async () => {
          if (removing) await deleteDomain.mutateAsync(removing.id);
        }}
      />
    </div>
  );
}

function AddDomainDialog({ zoneId, variant = 'default' }: { zoneId: string; variant?: 'default' | 'secondary' }) {
  const createDomain = useCreateDomain(zoneId);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next && createDomain.isPending) return;
    setOpen(next);
    if (!next) {
      setDomain('');
      setError(null);
      setFormError(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = createDomainSchema.safeParse({
      domain: domain.trim().toLowerCase(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid hostname.');
      return;
    }
    setError(null);
    try {
      await createDomain.mutateAsync(parsed.data);
      toast.success('Domain added', `Point a CNAME record for ${parsed.data.domain} at the edge, then verify it.`);
      handleOpenChange(false);
    } catch (err) {
      setFormError(errorMessage(err, 'Could not add the domain.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={variant} size={variant === 'secondary' ? 'sm' : 'default'} leftIcon={<Plus />}>
          Add domain
        </Button>
      </DialogTrigger>
      <DialogContent preventClose={createDomain.isPending}>
        <DialogForm onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Add domain</DialogTitle>
            <DialogDescription>
              Enter a hostname you control. You will point it at the edge with a CNAME record.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Domain" error={error} hint="A subdomain such as cdn.your-company.com works best.">
              <Input
                placeholder="cdn.your-company.com"
                value={domain}
                autoFocus
                autoComplete="off"
                onChange={(e) => {
                  setDomain(e.target.value);
                  if (error) setError(null);
                }}
                disabled={createDomain.isPending}
              />
            </Field>
            {formError && <ErrorBanner>{formError}</ErrorBanner>}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={createDomain.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={createDomain.isPending}>
              Add domain
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
