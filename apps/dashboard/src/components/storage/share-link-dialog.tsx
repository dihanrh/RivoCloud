'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useZones } from '@/hooks/use-zones';
import { useSignObject } from '@/hooks/use-sign-object';
import { errorMessage } from '@/lib/http';
import type { SignedUrl } from '@/lib/types';

const EXPIRY_OPTIONS = [
  { label: '15 minutes', seconds: 15 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 },
];

export function ShareLinkDialog({
  bucketId,
  objectKey,
  onOpenChange,
}: {
  bucketId: string;
  objectKey: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: zoneData, isLoading: zonesLoading } = useZones();
  const signObject = useSignObject(bucketId);
  const [zoneId, setZoneId] = useState('');
  const [expiresIn, setExpiresIn] = useState(EXPIRY_OPTIONS[0]!.seconds);
  const [download, setDownload] = useState(false);
  const [result, setResult] = useState<SignedUrl | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signing is refused for a zone that doesn't verify signatures, so only
  // offer the ones that do.
  const signingZones = (zoneData?.zones ?? []).filter((zone) => zone.signedUrlsRequired);
  const selectedZoneId = zoneId || signingZones[0]?.id || '';

  function handleOpenChange(open: boolean) {
    if (!open) {
      setResult(null);
      setError(null);
      setCopied(false);
    }
    onOpenChange(open);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!objectKey || !selectedZoneId) return;
    setError(null);
    setCopied(false);
    try {
      setResult(await signObject.mutateAsync({ key: objectKey, zoneId: selectedZoneId, expiresIn, download }));
    } catch (err) {
      setError(errorMessage(err, 'Could not create the share link. Try again.'));
    }
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
    } catch {
      setError('Copy failed. Select the link and copy it manually.');
    }
  }

  return (
    <Dialog open={objectKey !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share link</DialogTitle>
          <DialogDescription>
            Create a time-limited signed link to <span className="font-medium">{objectKey}</span>. Anyone with the link can
            download the file until it expires.
          </DialogDescription>
        </DialogHeader>
        {!zonesLoading && signingZones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No website requires signed URLs yet. Turn on &quot;Require signed URLs&quot; for a website that serves this bucket first.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-zone">Website</Label>
              <Select id="share-zone" value={selectedZoneId} onChange={(e) => setZoneId(e.target.value)}>
                {signingZones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-expiry">Expires after</Label>
              <Select
                id="share-expiry"
                value={expiresIn}
                onChange={(e) => setExpiresIn(Number(e.target.value))}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={download} onChange={(e) => setDownload(e.target.checked)} />
              Force download instead of opening in the browser
            </label>
            {result && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-url">Link</Label>
                <div className="flex gap-2">
                  <Input id="share-url" readOnly value={result.url} onFocus={(e) => e.target.select()} />
                  <Button type="button" variant="outline" onClick={handleCopy}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Expires {new Date(result.expiresAt).toLocaleString()}</p>
              </div>
            )}
            {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={signObject.isPending || !selectedZoneId}>
                {signObject.isPending ? 'Creating…' : result ? 'Create new link' : 'Create link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
