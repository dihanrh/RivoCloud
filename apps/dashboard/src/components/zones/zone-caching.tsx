'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { useUpdateZone } from '@/hooks/use-update-zone';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { Zone } from '@/lib/types';
import { CacheRules } from './cache-rules';
import { formatTtl } from './format';
import { CustomPurgeDialog, PurgeEverythingButton } from './purge-cache';
import { RecentPurges } from './recent-purges';
import { ReadOnlyNote, ZoneHeader } from './zone-shell';

export function ZoneCaching({ zone }: { zone: Zone }) {
  const { canPurge, canWrite, canDelete } = useZonePermissions();
  const readOnly = !canPurge && !canWrite && !canDelete;

  return (
    <div>
      <ZoneHeader
        zone={zone}
        section="Caching"
        description="Control what the edge caches for this website, and for how long."
        actions={
          canPurge ? (
            <>
              <CustomPurgeDialog zoneId={zone.id} />
              <PurgeEverythingButton zoneId={zone.id} zoneName={zone.name} variant="destructive-outline" />
            </>
          ) : readOnly ? (
            <ReadOnlyNote />
          ) : undefined
        }
      />

      <SectionTitle>Recent purges</SectionTitle>
      <RecentPurges zoneId={zone.id} />

      <div className="mt-8">
        <CacheRules zoneId={zone.id} />
      </div>

      <SectionTitle>Default cache lifetimes</SectionTitle>
      <div className="flex flex-col gap-4">
        <TtlSettingRow
          zone={zone}
          field="cacheTtl"
          title="Edge cache TTL"
          description="How long edge servers keep a file before checking your origin again, unless a cache rule says otherwise."
        />
        <TtlSettingRow
          zone={zone}
          field="browserTtl"
          title="Browser cache TTL"
          description="How long visitors' browsers may keep a file before asking for it again."
        />
      </div>
    </div>
  );
}

function TtlSettingRow({
  zone,
  field,
  title,
  description,
}: {
  zone: Zone;
  field: 'cacheTtl' | 'browserTtl';
  title: string;
  description: string;
}) {
  const { canWrite } = useZonePermissions();
  const toast = useToast();
  const update = useUpdateZone(zone.id);
  const [value, setValue] = useState(String(zone[field]));
  const [error, setError] = useState<string | null>(null);
  const dirty = value.trim() !== String(zone[field]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError('Enter a whole number of seconds, 0 or more.');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ [field]: Number(trimmed) });
      toast.success(`${title} saved`, `Now ${formatTtl(Number(trimmed)).toLowerCase()}.`);
    } catch (err) {
      toast.error(`Could not save the ${title.toLowerCase()}`, errorMessage(err, 'Try again in a moment.'));
    }
  }

  return (
    <SettingRow title={title} description={description}>
      <form onSubmit={save} className="flex items-start gap-2" noValidate>
        <Field className="flex-1" error={error} hint={`Currently ${formatTtl(zone[field]).toLowerCase()}.`}>
          <Input
            aria-label={`${title} in seconds`}
            inputMode="numeric"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            disabled={!canWrite || update.isPending}
            rightAddon="seconds"
          />
        </Field>
        {canWrite && (
          <Button type="submit" variant="secondary" disabled={!dirty} loading={update.isPending}>
            Save
          </Button>
        )}
      </form>
    </SettingRow>
  );
}
