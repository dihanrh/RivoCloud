'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createDomainSchema } from '@/lib/validation';
import { useDomains } from '@/hooks/use-domains';
import { useCreateDomain } from '@/hooks/use-create-domain';
import { useDeleteDomain } from '@/hooks/use-delete-domain';
import { useVerifyDomain } from '@/hooks/use-verify-domain';
import { errorMessage } from '@/lib/http';
import type { ZoneDomain } from '@/lib/types';

const STATUS_VARIANT: Record<ZoneDomain['sslStatus'], 'secondary' | 'default' | 'destructive'> = {
  pending_dns: 'secondary',
  pending_ssl: 'secondary',
  active: 'default',
  error: 'destructive',
};

export function ZoneDomains({ zoneId }: { zoneId: string }) {
  const { data: domains } = useDomains(zoneId);
  const createDomain = useCreateDomain(zoneId);
  const deleteDomain = useDeleteDomain(zoneId);
  const verifyDomain = useVerifyDomain(zoneId);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createDomainSchema.safeParse({ domain });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors');
      return;
    }

    try {
      await createDomain.mutateAsync(parsed.data);
      setDomain('');
    } catch (err) {
      setError(errorMessage(err, 'Could not add domain'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom Domains</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-domain">Domain</Label>
            <Input
              id="new-domain"
              placeholder="cdn.your-company.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={createDomain.isPending}>
            {createDomain.isPending ? 'Adding…' : 'Add domain'}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!domains?.length ? (
          <p className="text-sm text-muted-foreground">No custom domains yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CNAME target</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.domain}
                    {d.sslError && <p className="text-xs text-destructive">{d.sslError}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[d.sslStatus]}>{d.sslStatus === 'active' ? 'active' : d.sslStatus}</Badge>
                  </TableCell>
                  <TableCell>{d.cnameTarget}</TableCell>
                  <TableCell className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => verifyDomain.mutate(d.id)}
                      disabled={verifyDomain.isPending}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteDomain.mutate(d.id)}
                      disabled={deleteDomain.isPending}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
