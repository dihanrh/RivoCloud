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
import { createZoneSchema } from '@/lib/validation';
import { useCreateZone } from '@/hooks/use-create-zone';
import { errorMessage } from '@/lib/http';

export function CreateZoneDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [originUrl, setOriginUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createZone = useCreateZone();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createZoneSchema.safeParse({ name, originUrl });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors');
      return;
    }

    try {
      await createZone.mutateAsync(parsed.data);
      setOpen(false);
      setName('');
      setOriginUrl('');
    } catch (err) {
      setError(errorMessage(err, 'Could not create zone'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create zone</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a pull zone</DialogTitle>
          <DialogDescription>Enter a name and origin URL to create a new zone.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-name">Name</Label>
            <Input id="zone-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-origin">Origin URL</Label>
            <Input
              id="zone-origin"
              placeholder="https://origin.example.com"
              value={originUrl}
              onChange={(e) => setOriginUrl(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={createZone.isPending}>
              {createZone.isPending ? 'Creating…' : 'Create zone'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
