'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionTitle } from '@/components/ui/page-header';
import { useDeleteZone } from '@/hooks/use-delete-zone';
import { useUpdateZone, type OriginProtocol } from '@/hooks/use-update-zone';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { Zone } from '@/lib/types';
import { updateZoneSchema } from '@/lib/validation';
import { ORIGIN_PROTOCOL_LABEL } from './format';
import { Toggle } from './toggle';
import { ZoneHeader } from './zone-shell';

export function ZoneSettings({ zone }: { zone: Zone }) {
  const { canWrite, canDelete } = useZonePermissions();

  return (
    <div>
      <ZoneHeader zone={zone} section="Settings" description="General configuration for this website." />
      {!canWrite && (
        <p className="mb-4 text-[13px] text-muted-foreground">You have read-only access to this website.</p>
      )}
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
  const [name, setName] = useState(zone.name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = updateZoneSchema.pick({ name: true }).safeParse({ name: name.trim() });
    if (!parsed.success) {
      setError('Enter a name of 1 to 54 characters.');
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not rename the website.'));
    }
  }

  return (
    <SettingRow title="Website name" description="Shown across the dashboard. Renaming does not change the edge hostname.">
      <form onSubmit={save} className="flex flex-col gap-2" noValidate>
        <Label htmlFor="settings-name" className="sr-only">
          Website name
        </Label>
        <div className="flex gap-2">
          <Input
            id="settings-name"
            value={name}
            maxLength={54}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            disabled={!canWrite}
          />
          {canWrite && (
            <Button type="submit" variant="outline" disabled={name.trim() === zone.name || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
        {saved && <p className="text-xs text-muted-foreground">Saved.</p>}
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </form>
    </SettingRow>
  );
}

function OriginRow({ zone, canWrite }: { zone: Zone; canWrite: boolean }) {
  const update = useUpdateZone(zone.id);
  const [originUrl, setOriginUrl] = useState(zone.originUrl);
  const [protocol, setProtocol] = useState<OriginProtocol>((zone.originProtocol as OriginProtocol) ?? 'https');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = originUrl.trim() !== zone.originUrl || protocol !== zone.originProtocol;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = updateZoneSchema.pick({ originUrl: true }).safeParse({ originUrl: originUrl.trim() });
    if (!parsed.success) {
      setError('Enter a valid http(s) URL, for example https://origin.example.com.');
      return;
    }
    try {
      await update.mutateAsync({ originUrl: parsed.data.originUrl, originProtocol: protocol });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, 'Could not update the origin.'));
    }
  }

  return (
    <SettingRow
      title="Origin"
      description="Where the edge fetches content on a cache miss. The protocol sets how the edge connects to your origin."
    >
      <form onSubmit={save} className="flex flex-col gap-2" noValidate>
        <Label htmlFor="settings-origin" className="text-[13px]">
          Origin URL
        </Label>
        <Input
          id="settings-origin"
          type="url"
          value={originUrl}
          onChange={(e) => {
            setOriginUrl(e.target.value);
            setSaved(false);
          }}
          disabled={!canWrite}
        />
        <Label htmlFor="settings-protocol" className="mt-1 text-[13px]">
          Origin protocol
        </Label>
        <Select
          id="settings-protocol"
          value={protocol}
          onChange={(e) => {
            setProtocol(e.target.value as OriginProtocol);
            setSaved(false);
          }}
          disabled={!canWrite}
        >
          {Object.entries(ORIGIN_PROTOCOL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {canWrite && (
          <div>
            <Button type="submit" variant="outline" disabled={!dirty || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save origin'}
            </Button>
          </div>
        )}
        {saved && <p className="text-xs text-muted-foreground">Saved.</p>}
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </form>
    </SettingRow>
  );
}

function PauseRow({ zone, canWrite }: { zone: Zone; canWrite: boolean }) {
  const update = useUpdateZone(zone.id);
  const [error, setError] = useState<string | null>(null);
  const paused = !zone.enabled;

  async function toggle(nextPaused: boolean) {
    setError(null);
    try {
      await update.mutateAsync({ enabled: !nextPaused });
    } catch (err) {
      setError(errorMessage(err, nextPaused ? 'Could not pause the website.' : 'Could not resume the website.'));
    }
  }

  return (
    <SettingRow
      title="Pause website"
      description="While paused, the edge stops serving this website. Settings, rules, and domains are kept, and you can resume at any time."
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 md:justify-end">
          <span className="text-[13px] text-muted-foreground">{paused ? 'Paused' : 'Active'}</span>
          <Toggle label="Pause website" checked={paused} onChange={toggle} disabled={!canWrite || update.isPending} />
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </div>
    </SettingRow>
  );
}

function DeleteWebsiteRow({ zone }: { zone: Zone }) {
  const router = useRouter();
  const remove = useDeleteZone(zone.id);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTyped('');
      setError(null);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (typed !== zone.name) return;
    setError(null);
    try {
      await remove.mutateAsync();
      router.push('/zones');
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the website.'));
    }
  }

  return (
    <SettingRow
      className="border-destructive/40"
      title="Delete website"
      description="Permanently remove this website, its cache rules, custom domains, and purge history. The edge stops serving it right away."
    >
      <div className="flex md:justify-end">
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button variant="destructive-outline">Delete website</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {zone.name}?</DialogTitle>
              <DialogDescription>This cannot be undone. Type the website name to confirm.</DialogDescription>
            </DialogHeader>
            <form onSubmit={confirm} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delete-confirm">
                  Website name <span className="font-mono font-normal text-muted-foreground">{zone.name}</span>
                </Label>
                <Input
                  id="delete-confirm"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={typed !== zone.name || remove.isPending}>
                  {remove.isPending ? 'Deleting…' : 'Delete website'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </SettingRow>
  );
}
