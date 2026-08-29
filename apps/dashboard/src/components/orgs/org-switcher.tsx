'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelectOrg } from '@/hooks/use-select-org';

export function OrgSwitcher() {
  const router = useRouter();
  const { data: orgs, isLoading } = useOrgs();
  const selectOrg = useSelectOrg();

  async function pick(orgId: string) {
    await selectOrg.mutateAsync(orgId);
    router.push('/dashboard');
  }

  if (isLoading) return <p className="text-muted-foreground">Loading organizations…</p>;

  return (
    <div className="flex flex-col gap-3">
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
