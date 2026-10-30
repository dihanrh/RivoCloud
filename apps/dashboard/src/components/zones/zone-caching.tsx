'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/page-header';
import { useUpdateZone } from '@/hooks/use-update-zone';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { CacheInvalidationResult, Zone } from '@/lib/types';
import { CacheRules } from './cache-rules';
import { formatTtl } from './format';
import { CustomPurgeDialog, PurgeConfirmation, PurgeEverythingButton } from './purge-cache';
import { RecentPurges } from './recent-purges';
import { ZoneHeader } from './zone-shell';

export function ZoneCaching({ zone }: { zone: Zone }) {
  const { canPurge } = useZonePermissions();
  const [purged, setPurged] = useState<CacheInvalidationResult | null>(null);

  return (
    <div>
      <ZoneHeader zone={zone} section="Caching" description="Control what the edge caches for this website, and for how long." />

      <div className="flex flex-col gap-4">
        <SettingRow
          title="Purge cache"
          description="Remove cached files from every edge server. Purge everything, or only files matching URL paths or cache tags."
        >
          {canPurge ? (
            <div className="flex flex-wrap gap-2 md:justify-end">
              <CustomPurgeDialog zoneId={zone.id} onPurged={setPurged} />
              <PurgeEverythingButton zoneId={zone.id} zoneName={zone.name} onPurged={setPurged} />
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Your role cannot purge the cache.</p>
          )}
        </SettingRow>
        {purged && <PurgeConfirmation result={purged} />}
      </div>

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
  const update = useUpdateZone(zone.id);
  const [value, setValue] = useState(String(zone[field]));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputId = `zone-${field}`;
  const dirty = value.trim() !== String(zone[field]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError('Enter a whole number of seconds, 0 or more.');
      return;
    }
    try {
      await update.mutateAsync({ [field]: Number(trimmed) });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, `Could not save the ${title.toLowerCase()}.`));
    }
  }

  return (
    <SettingRow title={title} description={description}>
      <form onSubmit={save} className="flex flex-col gap-2" noValidate>
        <label htmlFor={inputId} className="sr-only">
          {title} in seconds
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id={inputId}
              inputMode="numeric"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
              disabled={!canWrite}
              className="pr-16"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              seconds
            </span>
          </div>
          {canWrite && (
            <Button type="submit" variant="outline" disabled={!dirty || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {saved ? 'Saved.' : `Currently ${formatTtl(zone[field]).toLowerCase()}.`}
        </p>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </form>
    </SettingRow>
  );
}
