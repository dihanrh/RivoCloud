'use client';

import { SettingsGate } from '@/components/settings/settings-gate';
import { ApiKeysPanel } from '@/components/settings/api-keys-panel';
import { PageHeader } from '@/components/ui/page-header';

export default function ApiKeysPage() {
  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys let scripts and CI call the RivoCloud API on your behalf."
        crumbs={[{ label: 'Manage account' }, { label: 'API keys' }]}
      />
      <SettingsGate>{(me) => <ApiKeysPanel role={me.role} meId={me.id} />}</SettingsGate>
    </>
  );
}
