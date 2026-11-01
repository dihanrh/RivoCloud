'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { SectionTitle } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useDeleteZone } from '@/hooks/use-delete-zone';
import { useUpdateZone, type OriginProtocol } from '@/hooks/use-update-zone';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { Zone } from '@/lib/types';
import { updateZoneSchema } from '@/lib/validation';
import { ORIGIN_PROTOCOL_LABEL } from './format';
import { ReadOnlyNote, ZoneHeader } from './zone-shell';

export function ZoneSettings({ zone }: { zone: Zone }) {
  const { canWrite, canDelete } = useZonePermissions();

  return (
    <div>
      <ZoneHeader
        zone={zone}
        section="Settings"
        description="General configuration for this website."
        actions={!canWrite && !canDelete ? <ReadOnlyNote>View only: your role can&apos;t change settings</ReadOnlyNote> : undefined}
      />
      <SectionTitle>General</SectionTitle>
      <div className="flex flex-col gap-4">
        <NameRow zone={zone} canWrite={canWrite} />
        <OriginRow zone={zone} canWrite={canWrite} />
        <PauseRow zone={zone} canWrite={canWrite} />
      </div>
      {canDelete && (
        <>
          <SectionTitle>Danger zone</SectionTitle>
          <DeleteWebsiteRow zone={zone} />
        </>
      )}
    </div>
  );
}

function NameRow({ zone, canWrite }: { zone: Zone; canWrite: boolean }) {
  const update = useUpdateZone(zone.id);
  const toast = useToast();
  const [name, setName] = useState(zone.name);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = updateZoneSchema.pick({ name: true }).safeParse({ name: name.trim() });
    if (!parsed.success) {
      setError('Enter a name of 1 to 54 characters.');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync(parsed.data);
      toast.success('Website renamed', `It is now called ${parsed.data.name}.`);
    } catch (err) {
      toast.error('Could not rename the website', errorMessage(err, 'Try again in a moment.'));
    }
  }

  return (
    <SettingRow title="Website name" description="Shown across the dashboard. Renaming does not change the edge hostname.">
      <form onSubmit={save} className="flex items-start gap-2" noValidate>
        <Field className="flex-1" error={error}>
          <Input
            aria-label="Website name"
            value={name}
            maxLength={54}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            disabled={!canWrite || update.isPending}
          />
        </Field>
        {canWrite && (
          <Button type="submit" variant="secondary" disabled={name.trim() === zone.name} loading={update.isPending}>
            Save
          </Button>
        )}
      </form>
    </SettingRow>
  );
}

function OriginRow({ zone, canWrite }: { zone: Zone; canWrite: boolean }) {
  const update = useUpdateZone(zone.id);
  const toast = useToast();
  const [originUrl, setOriginUrl] = useState(zone.originUrl);
  const [protocol, setProtocol] = useState<OriginProtocol>((zone.originProtocol as OriginProtocol) ?? 'https');
  const [error, setError] = useState<string | null>(null);
  const dirty = originUrl.trim() !== zone.originUrl || protocol !== zone.originProtocol;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = originUrl.trim();
    const parsed = updateZoneSchema.pick({ originUrl: true }).safeParse({ originUrl: trimmed });
    if (!parsed.success || !/^https?:\/\//i.test(trimmed)) {
      setError('Enter a full http(s) URL, for example https://origin.example.com.');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ originUrl: trimmed, originProtocol: protocol });
      toast.success('Origin saved', `The edge now fetches from ${trimmed}.`);
    } catch (err) {
      toast.error('Could not save the origin', errorMessage(err, 'Try again in a moment.'));
    }
  }

  return (
    <SettingRow
      title="Origin"
      description="Where the edge fetches content on a cache miss. The protocol sets how the edge connects to your origin."
    >
      <form onSubmit={save} className="flex flex-col gap-3 md:w-80" noValidate>
        <Field label="Origin URL" error={error}>
          <Input
            type="url"
            value={originUrl}
            onChange={(e) => {
              setOriginUrl(e.target.value);
              if (error) setError(null);
            }}
            disabled={!canWrite || update.isPending}
          />
        </Field>
        <Field label="Origin protocol">
          <Select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as OriginProtocol)}
            disabled={!canWrite || update.isPending}
          >
            {Object.entries(ORIGIN_PROTOCOL_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {canWrite && (
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" disabled={!dirty} loading={update.isPending}>
              Save origin
            </Button>
          </div>
        )}
      </form>
    </SettingRow>
  );
}

function PauseRow({ zone, canWrite }: { zone: Zone; canWrite: boolean }) {
  const update = useUpdateZone(zone.id);
  const toast = useToast();
  const paused = !zone.enabled;

  async function toggle(nextPaused: boolean) {
    try {
      await update.mutateAsync({ enabled: !nextPaused });
      toast.success(
        nextPaused ? 'Website paused' : 'Website resumed',
        nextPaused ? 'The edge has stopped serving it.' : 'The edge is serving it again.',
      );
    } catch (err) {
      toast.error(nextPaused ? 'Could not pause the website' : 'Could not resume the website', errorMessage(err, 'Try again in a moment.'));
    }
  }

  return (
    <SettingRow
      title="Pause website"
      description="While paused, the edge stops serving this website. Settings, rules, and domains are kept, and you can resume at any time."
    >
      <div className="flex items-center gap-3 md:justify-end">
        <span className="text-[13px] text-muted-foreground">{paused ? 'Paused' : 'Active'}</span>
        <Switch
          label="Pause website"
          checked={paused}
          onCheckedChange={(next) => void toggle(next)}
          disabled={!canWrite}
          loading={update.isPending}
        />
      </div>
    </SettingRow>
  );
}

function DeleteWebsiteRow({ zone }: { zone: Zone }) {
  const router = useRouter();
  const remove = useDeleteZone(zone.id);

  return (
    <SettingRow
      className="border-destructive/40"
      title="Delete website"
      description="Permanently remove this website, its cache rules, custom domains, and purge history. The edge stops serving it right away."
    >
      <div className="flex md:justify-end">
        <ConfirmDialog
          trigger={
            <Button variant="destructive-outline" leftIcon={<Trash2 />}>
              Delete website
            </Button>
          }
          tone="destructive"
          title="Delete website"
          description={
            <>
              This permanently removes <b className="font-semibold text-foreground">{zone.name}</b>, its cache rules, custom
              domains, and purge history. This cannot be undone.
            </>
          }
          confirmLabel="Delete website"
          requireText={zone.name}
          successToast={{ title: 'Website deleted', description: `${zone.name} was removed.` }}
          errorFallback="Could not delete the website."
          onConfirm={async () => {
            await remove.mutateAsync();
            router.push('/zones');
          }}
        />
      </div>
    </SettingRow>
  );
}
