'use client';

import { useState } from 'react';
import { Eraser, Filter } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useInvalidateCache, usePurgeEverything } from '@/hooks/use-cache-purge';
import { errorMessage } from '@/lib/http';
import type { CacheInvalidationResult } from '@/lib/types';
import { splitLines } from './format';

export const MAX_PURGE_ENTRIES = 100;
export const MAX_PURGE_ENTRY_LENGTH = 255;

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** "Purge everything" button + destructive confirmation; toasts on success. */
export function PurgeEverythingButton({
  zoneId,
  zoneName,
  onPurged,
  variant = 'secondary',
  size = 'default',
}: {
  zoneId: string;
  zoneName: string;
  onPurged?: (result: CacheInvalidationResult) => void;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}) {
  const purge = usePurgeEverything(zoneId);

  return (
    <ConfirmDialog
      trigger={
        <Button variant={variant} size={size} leftIcon={<Eraser />}>
          Purge everything
        </Button>
      }
      tone="destructive"
      title="Purge everything"
      description={
        <>
          Every cached file for <b className="font-semibold text-foreground">{zoneName}</b> is removed from the edge. The next
          requests go to your origin, which may see a spike in traffic until the cache fills again.
        </>
      }
      confirmLabel="Purge everything"
      successToast={{ title: 'Cache purged', description: `Edge servers are clearing every cached file for ${zoneName}.` }}
      errorFallback="Could not purge the cache. Try again in a minute."
      onConfirm={async () => {
        const result = await purge.mutateAsync();
        onPurged?.(result);
      }}
    />
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
  size = 'default',
}: {
  zoneId: string;
  onPurged?: (result: CacheInvalidationResult) => void;
  size?: ButtonProps['size'];
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [patternsText, setPatternsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [errors, setErrors] = useState<{ patterns?: string; tags?: string; form?: string }>({});
  const invalidate = useInvalidateCache(zoneId);

  function handleOpenChange(next: boolean) {
    if (!next && invalidate.isPending) return;
    setOpen(next);
    if (!next) {
      setPatternsText('');
      setTagsText('');
      setErrors({});
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const patterns = splitLines(patternsText);
    const tags = splitLines(tagsText);
    if (patterns.length === 0 && tags.length === 0) {
      setErrors({ form: 'Enter at least one URL path or cache tag.' });
      return;
    }
    const next = {
      patterns: validateEntries('URL paths', patterns) ?? undefined,
      tags: validateEntries('cache tags', tags) ?? undefined,
    };
    setErrors(next);
    if (next.patterns || next.tags) return;

    try {
      const result = await invalidate.mutateAsync({
        ...(patterns.length > 0 && { patterns }),
        ...(tags.length > 0 && { tags }),
      });
      const what = [patterns.length && plural(patterns.length, 'path'), tags.length && plural(tags.length, 'tag')]
        .filter(Boolean)
        .join(' and ');
      toast.success('Cache purged', `Edge servers are clearing files matching ${what}.`);
      handleOpenChange(false);
      onPurged?.(result);
    } catch (err) {
      setErrors({ form: errorMessage(err, 'Could not purge the cache. Try again in a minute.') });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" size={size} leftIcon={<Filter />}>
          Custom purge
        </Button>
      </DialogTrigger>
      <DialogContent size="lg" preventClose={invalidate.isPending}>
        <DialogForm onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Custom purge</DialogTitle>
            <DialogDescription>
              Remove only matching files from the edge cache. Enter one entry per line, up to {MAX_PURGE_ENTRIES} of each.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="URL paths" hint="Use * to match any characters, for example /images/*." error={errors.patterns}>
              <Textarea
                placeholder={'/images/*\n/css/site.css'}
                value={patternsText}
                rows={4}
                autoFocus
                onChange={(e) => {
                  setPatternsText(e.target.value);
                  if (errors.patterns || errors.form) setErrors((x) => ({ ...x, patterns: undefined, form: undefined }));
                }}
                disabled={invalidate.isPending}
              />
            </Field>
            <Field label="Cache tags" hint="Tags your origin sends in the Cache-Tag response header." error={errors.tags}>
              <Textarea
                placeholder={'product-123\nhomepage'}
                value={tagsText}
                rows={3}
                onChange={(e) => {
                  setTagsText(e.target.value);
                  if (errors.tags || errors.form) setErrors((x) => ({ ...x, tags: undefined, form: undefined }));
                }}
                disabled={invalidate.isPending}
              />
            </Field>
            {errors.form && <ErrorBanner>{errors.form}</ErrorBanner>}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={invalidate.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={invalidate.isPending}>
              Purge
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
