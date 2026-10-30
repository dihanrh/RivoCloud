'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { useInvalidateCache, usePurgeEverything } from '@/hooks/use-cache-purge';
import { errorMessage } from '@/lib/http';
import type { CacheInvalidationResult } from '@/lib/types';
import { splitLines } from './format';

export const MAX_PURGE_ENTRIES = 100;
export const MAX_PURGE_ENTRY_LENGTH = 255;

/** Shows the purge request id and status returned by the API. */
export function PurgeConfirmation({ result }: { result: CacheInvalidationResult }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-[var(--radius)] border border-success/30 bg-success-soft px-4 py-3 text-[13px]">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
      <div>
        <p className="font-medium text-foreground">Purge requested. Edge servers are clearing the cache now.</p>
        <p className="mt-0.5 text-muted-foreground">
          Request <span className="font-mono">{result.invalidationId}</span>, status {result.status}.
        </p>
      </div>
    </div>
  );
}

/** "Purge everything" with a confirm dialog. */
export function PurgeEverythingButton({
  zoneId,
  zoneName,
  onPurged,
  variant = 'outline',
}: {
  zoneId: string;
  zoneName: string;
  onPurged?: (result: CacheInvalidationResult) => void;
  variant?: 'outline' | 'default';
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purge = usePurgeEverything(zoneId);

  async function confirm() {
    setError(null);
    try {
      const result = await purge.mutateAsync();
      setOpen(false);
      onPurged?.(result);
    } catch (err) {
      setError(errorMessage(err, 'Could not purge the cache. Try again in a minute.'));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          Purge everything
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Purge everything?</DialogTitle>
          <DialogDescription>
            Every cached file for {zoneName} is removed from the edge. The next requests go to your origin, which may see
            a spike in traffic until the cache fills again.
          </DialogDescription>
        </DialogHeader>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={purge.isPending}>
            {purge.isPending ? 'Purging…' : 'Purge everything'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function validateEntries(kind: string, entries: string[]): string | null {
  if (entries.length > MAX_PURGE_ENTRIES) return `Enter at most ${MAX_PURGE_ENTRIES} ${kind} per request.`;
  const tooLong = entries.find((e) => e.length > MAX_PURGE_ENTRY_LENGTH);
  if (tooLong) return `Each of the ${kind} must be ${MAX_PURGE_ENTRY_LENGTH} characters or fewer.`;
  return null;
}

/** Purge by URL path patterns and/or cache tags, one per line. */
export function CustomPurgeDialog({
  zoneId,
  onPurged,
}: {
  zoneId: string;
  onPurged?: (result: CacheInvalidationResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [patternsText, setPatternsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidateCache(zoneId);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setPatternsText('');
      setTagsText('');
      setError(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const patterns = splitLines(patternsText);
    const tags = splitLines(tagsText);
    if (patterns.length === 0 && tags.length === 0) {
      setError('Enter at least one URL path or cache tag.');
      return;
    }
    const problem = validateEntries('URL paths', patterns) ?? validateEntries('cache tags', tags);
    if (problem) {
      setError(problem);
      return;
    }

    try {
      const result = await invalidate.mutateAsync({
        ...(patterns.length > 0 && { patterns }),
        ...(tags.length > 0 && { tags }),
      });
      handleOpenChange(false);
      onPurged?.(result);
    } catch (err) {
      setError(errorMessage(err, 'Could not purge the cache. Try again in a minute.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Custom purge
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Custom purge</DialogTitle>
          <DialogDescription>
            Remove only matching files from the edge cache. Enter one entry per line, up to {MAX_PURGE_ENTRIES} of each.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="purge-patterns">URL paths</Label>
            <Textarea
              id="purge-patterns"
              placeholder={'/images/*\n/css/site.css'}
              value={patternsText}
              onChange={(e) => setPatternsText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Use * to match any characters, for example /images/*.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="purge-tags">Cache tags</Label>
            <Textarea
              id="purge-tags"
              placeholder={'product-123\nhomepage'}
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Tags your origin sends in the Cache-Tag response header.</p>
          </div>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invalidate.isPending}>
              {invalidate.isPending ? 'Purging…' : 'Purge'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
