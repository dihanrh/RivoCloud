'use client';

import { ShieldAlert } from 'lucide-react';
import { SettingsGate } from '@/components/settings/settings-gate';
import { AuditLogPanel } from '@/components/settings/audit-log-panel';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { canViewAuditLog } from '@/lib/rbac';

export default function AuditLogPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="A record of who changed what in this account."
        crumbs={[{ label: 'Manage account' }, { label: 'Audit log' }]}
      />
      <SettingsGate>
        {(me) =>
          canViewAuditLog(me.role) ? (
            <AuditLogPanel orgId={me.orgId} />
          ) : (
            <Card>
              <EmptyState
                icon={ShieldAlert}
                title="You can't view the audit log"
                description="Only account owners and admins can view the audit log. Ask an owner or admin if you need access."
              />
            </Card>
          )
        }
      </SettingsGate>
    </>
  );
}
