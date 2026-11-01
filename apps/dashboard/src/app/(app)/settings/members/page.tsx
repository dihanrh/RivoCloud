'use client';

import { SettingsGate } from '@/components/settings/settings-gate';
import { MembersPanel } from '@/components/settings/members-panel';
import { PageHeader } from '@/components/ui/page-header';

export default function MembersPage() {
  return (
    <>
      <PageHeader
        title="Members"
        description="People who can access this account, and what they can do."
        crumbs={[{ label: 'Manage account' }, { label: 'Members' }]}
      />
      <SettingsGate>{(me) => <MembersPanel orgId={me.orgId} role={me.role} meId={me.id} />}</SettingsGate>
    </>
  );
}
