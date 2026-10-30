'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
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
import { ErrorBanner } from '@/components/ui/empty-state';
import { createZoneSchema } from '@/lib/validation';
import { useCreateZone } from '@/hooks/use-create-zone';
import { errorMessage } from '@/lib/http';

export function CreateZoneDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [originUrl, setOriginUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createZone = useCreateZone();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setName('');
      setOriginUrl('');
      setError(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createZoneSchema.safeParse({ name: name.trim(), originUrl: originUrl.trim() });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.path[0] === 'name' ? 'Enter a name of 1 to 54 characters.' : (issue?.message ?? 'Check the form for errors'));
      return;
    }

    try {
      const zone = await createZone.mutateAsync(parsed.data);
      handleOpenChange(false);
      router.push(`/zones/${zone.id}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not add the website. Check the origin URL and try again.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add a website
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a website</DialogTitle>
          <DialogDescription>
            We fetch content from your origin and cache it at the edge. You get an edge hostname right away and can add
            custom domains later.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-name">Name</Label>
            <Input id="zone-name" placeholder="my-blog" value={name} onChange={(e) => setName(e.target.value)} maxLength={54} />
            <p className="text-xs text-muted-foreground">Used in the edge hostname. Letters, numbers, and dashes work best.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-origin">Origin URL</Label>
            <Input
              id="zone-origin"
              type="url"
              placeholder="https://origin.example.com"
              value={originUrl}
              onChange={(e) => setOriginUrl(e.target.value)}
            />
          </div>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createZone.isPending}>
              {createZone.isPending ? 'Adding…' : 'Add website'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
