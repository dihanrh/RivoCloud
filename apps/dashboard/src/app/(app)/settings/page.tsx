'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiKeysPanel } from '@/components/settings/api-keys-panel';
import { AuditLogPanel } from '@/components/settings/audit-log-panel';
import { MembersPanel } from '@/components/settings/members-panel';
import { useMe } from '@/hooks/use-me';
import { canViewAuditLog } from '@/lib/rbac';

type Tab = 'members' | 'api-keys' | 'audit-log';

export default function SettingsPage() {
  const { data: me, isLoading, error } = useMe();
  const [tab, setTab] = useState<Tab>('members');

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !me) return <p className="text-destructive">Failed to load your profile.</p>;
  if (!me.orgId) return <p className="text-muted-foreground">Select an organization first.</p>;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'members', label: 'Members' },
    { id: 'api-keys', label: 'API keys' },
    ...(canViewAuditLog(me.role) ? [{ id: 'audit-log' as const, label: 'Audit log' }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div role="tablist" className="flex gap-2">
        {tabs.map((t) => (
          <Button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            variant={tab === t.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          {tab === 'members' && <MembersPanel orgId={me.orgId} role={me.role} />}
          {tab === 'api-keys' && <ApiKeysPanel role={me.role} meId={me.id} />}
          {tab === 'audit-log' && canViewAuditLog(me.role) && <AuditLogPanel orgId={me.orgId} />}
        </CardContent>
      </Card>
    </div>
  );
}
