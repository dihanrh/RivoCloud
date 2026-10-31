'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useCreateBucket } from '@/hooks/use-create-bucket';
import { errorMessage } from '@/lib/http';
import { createBucketSchema } from '@/lib/validation';

/**
 * "Create bucket" dialog. Controlled (`open` / `onOpenChange`) so the page can open it from
 * its header button, the empty state, or `?create=1`. On success it toasts and opens the bucket.
 */
export function CreateBucketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const router = useRouter();
  const createBucket = useCreateBucket();
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = createBucket.isPending;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      setName('');
      setIsPublic(false);
      setNameError(null);
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createBucketSchema.safeParse({ name: name.trim(), public: isPublic });
    if (!parsed.success) {
      setNameError(name.trim() ? 'Use 63 characters or fewer.' : 'Enter a bucket name.');
      return;
    }
    setNameError(null);
    try {
      const bucket = await createBucket.mutateAsync(parsed.data);
      toast.success('Bucket created', `${bucket.name} is ready for uploads.`);
      handleOpenChangeAfterSuccess();
      router.push(`/storage/${bucket.id}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the bucket. Try again.'));
    }
  }

  function handleOpenChangeAfterSuccess() {
    setName('');
    setIsPublic(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm" preventClose={pending}>
        <DialogForm onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Create bucket</DialogTitle>
            <DialogDescription>Buckets hold your files. Choose a name you will recognize.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Name" hint="Unique within this account, up to 63 characters." error={nameError} required>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="e.g. user-uploads"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </Field>
            <Checkbox
              label="Public bucket"
              description="Anyone with a file's URL can read it. Leave off to share files with signed links instead."
              checked={isPublic}
              onCheckedChange={setIsPublic}
            />
            {error && (
              <div role="alert" className="rounded-[var(--radius)] border border-destructive/40 bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              Create bucket
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
