'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelectOrg } from '@/hooks/use-select-org';
import { errorMessage } from '@/lib/http';

export function OrgSwitcher() {
  const router = useRouter();
  const { data: orgs, isLoading } = useOrgs();
  const selectOrg = useSelectOrg();
  const [error, setError] = useState<string | null>(null);

  async function pick(orgId: string) {
    setError(null);
    try {
      await selectOrg.mutateAsync(orgId);
      router.push('/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Could not select organization'));
    }
  }

  if (isLoading) return <p className="text-muted-foreground">Loading organizations…</p>;

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {orgs?.map((org) => (
        <Card key={org.id}>
          <CardContent className="flex items-center justify-between p-4">
            <span className="font-medium">{org.name}</span>
            <Button size="sm" onClick={() => pick(org.id)} disabled={selectOrg.isPending}>
              Select
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
