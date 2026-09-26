'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUpdateZone } from '@/hooks/use-update-zone';
import { useRotateSigningSecret } from '@/hooks/use-rotate-signing-secret';
import { errorMessage } from '@/lib/http';
import type { Zone } from '@/lib/types';

export function ZoneSignedUrls({ zone }: { zone: Zone }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const updateZone = useUpdateZone(zone.id);
  const rotate = useRotateSigningSecret(zone.id);

  async function handleToggle(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setNotice(null);
    try {
      await updateZone.mutateAsync({ signedUrlsRequired: event.target.checked });
    } catch (err) {
      setError(errorMessage(err, 'Could not update signed URL setting'));
    }
  }

  async function handleRotate() {
    if (!window.confirm('Rotate the signing secret? Every signed link already shared for this zone will stop working.')) return;
    setError(null);
    setNotice(null);
    try {
      await rotate.mutateAsync();
      setNotice('Signing secret rotated. Previously shared links no longer work.');
    } catch (err) {
      setError(errorMessage(err, 'Could not rotate the signing secret'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed URLs</CardTitle>
        <CardDescription>
          When required, the edge only serves requests that carry a valid, unexpired signature. Generate links from a file&apos;s
          &quot;Share link&quot; action in Storage.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={zone.signedUrlsRequired}
            onChange={handleToggle}
            disabled={updateZone.isPending}
          />
          Require signed URLs
        </label>
        {zone.hasSigningSecret && (
          <div>
            <Button variant="outline" onClick={handleRotate} disabled={rotate.isPending}>
              {rotate.isPending ? 'Rotating…' : 'Rotate signing secret'}
            </Button>
          </div>
        )}
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
