'use client';

import { useState } from 'react';
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
import { useUpdateZone } from '@/hooks/use-update-zone';
import { useRotateSigningSecret } from '@/hooks/use-rotate-signing-secret';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { Zone } from '@/lib/types';
import { Toggle } from './toggle';

/** Signed URL settings for a website, as console setting rows. */
export function ZoneSignedUrls({ zone }: { zone: Zone }) {
  const { canWrite } = useZonePermissions();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const updateZone = useUpdateZone(zone.id);
  const rotate = useRotateSigningSecret(zone.id);

  async function handleToggle(next: boolean) {
    setError(null);
    setNotice(null);
    try {
      await updateZone.mutateAsync({ signedUrlsRequired: next });
    } catch (err) {
      setError(errorMessage(err, 'Could not update the signed URL setting. Try again.'));
    }
  }

  async function handleRotate() {
    setError(null);
    setNotice(null);
    try {
      await rotate.mutateAsync();
      setConfirmOpen(false);
      setNotice('Signing secret rotated. Previously shared links no longer work.');
    } catch (err) {
      setConfirmOpen(false);
      setError(errorMessage(err, 'Could not rotate the signing secret. Try again.'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Require signed URLs"
        description={
          <>
            When on, the edge only serves requests that carry a valid, unexpired signature. Create signed links from a
            file&apos;s Share link action in Storage.
          </>
        }
      >
        <div className="flex items-center gap-3 md:justify-end">
          <span className="text-[13px] text-muted-foreground">{zone.signedUrlsRequired ? 'On' : 'Off'}</span>
          <Toggle
            label="Require signed URLs"
            checked={zone.signedUrlsRequired}
            onChange={handleToggle}
            disabled={!canWrite || updateZone.isPending}
          />
        </div>
      </SettingRow>

      {zone.hasSigningSecret && (
        <SettingRow
          title="Rotate signing secret"
          description="Replace the secret used to sign links. Every signed link already shared for this website stops working immediately."
        >
          {canWrite ? (
            <div className="flex md:justify-end">
              <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">Rotate signing secret</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Rotate the signing secret?</DialogTitle>
                    <DialogDescription>
                      Existing signed links for {zone.name} stop working right away. You will need to create and share new
                      links.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleRotate} disabled={rotate.isPending}>
                      {rotate.isPending ? 'Rotating…' : 'Rotate secret'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Your role cannot rotate the secret.</p>
          )}
        </SettingRow>
      )}

      {notice && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {notice}
        </p>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </div>
  );
}
