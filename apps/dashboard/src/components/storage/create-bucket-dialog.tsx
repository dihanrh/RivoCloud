'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createBucketSchema } from '@/lib/validation';
import { useCreateBucket } from '@/hooks/use-create-bucket';
import { errorMessage } from '@/lib/http';

export function CreateBucketDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createBucket = useCreateBucket();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createBucketSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid bucket name');
      return;
    }

    try {
      await createBucket.mutateAsync(parsed.data);
      setOpen(false);
      setName('');
    } catch (err) {
      setError(errorMessage(err, 'Could not create bucket'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create bucket</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a bucket</DialogTitle>
          <DialogDescription>Choose a name for your new bucket.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bucket-name">Name</Label>
            <Input id="bucket-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={createBucket.isPending}>
              {createBucket.isPending ? 'Creating…' : 'Create bucket'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
