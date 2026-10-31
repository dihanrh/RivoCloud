'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SectionTitle } from '@/components/ui/page-header';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useRotateSigningSecret } from '@/hooks/use-rotate-signing-secret';
import { useUpdateZone } from '@/hooks/use-update-zone';
import { useZonePermissions } from '@/hooks/use-zone-permissions';
import { errorMessage } from '@/lib/http';
import type { Zone } from '@/lib/types';
import { ReadOnlyNote, ZoneHeader } from './zone-shell';

/** The website's Security page. */
export function ZoneSecurity({ zone }: { zone: Zone }) {
  const { canWrite } = useZonePermissions();
  return (
    <div>
      <ZoneHeader
        zone={zone}
        section="Security"
        description="Control who can fetch content from this website."
        actions={!canWrite ? <ReadOnlyNote /> : undefined}
      />
      <SectionTitle>Signed URLs</SectionTitle>
      <ZoneSignedUrls zone={zone} />
    </div>
  );
}

/** Signed URL settings for a website, as console setting rows. */
export function ZoneSignedUrls({ zone }: { zone: Zone }) {
  const { canWrite } = useZonePermissions();
  const toast = useToast();
  const updateZone = useUpdateZone(zone.id);
  const rotate = useRotateSigningSecret(zone.id);

  async function handleToggle(next: boolean) {
    try {
      await updateZone.mutateAsync({ signedUrlsRequired: next });
      toast.success(
        next ? 'Signed URLs required' : 'Signed URLs no longer required',
        next ? 'Requests without a valid signature are now refused.' : 'Anyone with a link can fetch content again.',
      );
    } catch (err) {
      toast.error('Could not update the signed URL setting', errorMessage(err, 'Try again in a moment.'));
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
          <Switch
            label="Require signed URLs"
            checked={zone.signedUrlsRequired}
            onCheckedChange={(next) => void handleToggle(next)}
            disabled={!canWrite}
            loading={updateZone.isPending}
          />
        </div>
      </SettingRow>

      {zone.hasSigningSecret && (
        <SettingRow
          title="Rotate signing secret"
          description="Replace the secret used to sign links. Every signed link already shared for this website stops working immediately."
        >
          {canWrite && (
            <div className="flex md:justify-end">
              <ConfirmDialog
                trigger={
                  <Button variant="secondary" leftIcon={<RefreshCw />}>
                    Rotate signing secret
                  </Button>
                }
                tone="destructive"
                title="Rotate signing secret"
                description={
                  <>
                    Existing signed links for <b className="font-semibold text-foreground">{zone.name}</b> stop working right
                    away. You will need to create and share new links.
                  </>
                }
                confirmLabel="Rotate secret"
                successToast={{ title: 'Signing secret rotated', description: 'Previously shared links no longer work.' }}
                errorFallback="Could not rotate the signing secret. Try again."
                onConfirm={() => rotate.mutateAsync()}
              />
            </div>
          )}
        </SettingRow>
      )}
    </div>
  );
}
