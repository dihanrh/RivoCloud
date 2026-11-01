'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useSignObject } from '@/hooks/use-sign-object';
import { useZones } from '@/hooks/use-zones';
import { formatDateTime } from '@/lib/format';
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
  const toast = useToast();
  const { data: zoneData, isLoading: zonesLoading } = useZones();
  const signObject = useSignObject(bucketId);
  const [zoneId, setZoneId] = useState('');
  const [expiresIn, setExpiresIn] = useState(EXPIRY_OPTIONS[0]!.seconds);
  const [download, setDownload] = useState(false);
  const [result, setResult] = useState<SignedUrl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = signObject.isPending;

  // Signing is refused for a zone that doesn't verify signatures, so only offer the ones that do.
  const signingZones = (zoneData?.zones ?? []).filter((zone) => zone.signedUrlsRequired);
  const selectedZoneId = zoneId || signingZones[0]?.id || '';
  const noSigningZones = !zonesLoading && signingZones.length === 0;

  function handleOpenChange(open: boolean) {
    if (pending) return;
    if (!open) {
      setResult(null);
      setError(null);
    }
    onOpenChange(open);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!objectKey || !selectedZoneId) return;
    setError(null);
    try {
      setResult(await signObject.mutateAsync({ key: objectKey, zoneId: selectedZoneId, expiresIn, download }));
      toast.success('Share link created', 'Copy it before you close this dialog.');
    } catch (err) {
      setError(errorMessage(err, 'Could not create the share link. Try again.'));
    }
  }

  return (
    <Dialog open={objectKey !== null} onOpenChange={handleOpenChange}>
      <DialogContent preventClose={pending}>
        <DialogForm onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Share link</DialogTitle>
            <DialogDescription>
              Create a time-limited signed link to <span className="break-all font-medium text-foreground">{objectKey}</span>. Anyone
              with the link can download the file until it expires.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {zonesLoading ? (
              <div className="flex flex-col gap-3" aria-hidden>
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : noSigningZones ? (
              <div className="flex items-start gap-3 rounded-[var(--radius)] border border-border bg-muted px-4 py-3 text-[13px]">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-muted-foreground">
                  No website requires signed URLs yet. Turn on &quot;Require signed URLs&quot; for a website that serves this bucket
                  first.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Website">
                    <Select id="share-zone" value={selectedZoneId} onChange={(e) => setZoneId(e.target.value)} disabled={pending}>
                      {signingZones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Expires after">
                    <Select id="share-expiry" value={expiresIn} onChange={(e) => setExpiresIn(Number(e.target.value))} disabled={pending}>
                      {EXPIRY_OPTIONS.map((option) => (
                        <option key={option.seconds} value={option.seconds}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Checkbox
                  label="Force download instead of opening in the browser"
                  checked={download}
                  onCheckedChange={setDownload}
                  disabled={pending}
                />
                {result && (
                  <div className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-success/30 bg-success-soft/60 p-3">
                    <label htmlFor="share-url" className="text-[13px] font-medium">
                      Link
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="share-url"
                        readOnly
                        value={result.url}
                        onFocus={(e) => e.target.select()}
                        className="bg-background font-mono text-xs"
                      />
                      <CopyButton value={result.url} label="Copy link" size="icon" variant="secondary" />
                    </div>
                    <p className="text-xs text-muted-foreground">Expires {formatDateTime(result.expiresAt)}</p>
                  </div>
                )}
              </>
            )}
            {error && (
              <div role="alert" className="rounded-[var(--radius)] border border-destructive/40 bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                {result || noSigningZones ? 'Close' : 'Cancel'}
              </Button>
            </DialogClose>
            {!noSigningZones && (
              <Button type="submit" loading={pending} disabled={!selectedZoneId}>
                {result ? 'Create new link' : 'Create link'}
              </Button>
            )}
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
