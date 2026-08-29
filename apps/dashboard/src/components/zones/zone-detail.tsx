'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { updateZoneSchema } from '@/lib/validation';
import { useUpdateZone } from '@/hooks/use-update-zone';
import { useDeleteZone } from '@/hooks/use-delete-zone';
import { ApiError } from '@/lib/http';
import type { Zone } from '@/lib/types';

export function ZoneDetail({ zone }: { zone: Zone }) {
  const router = useRouter();
  const [name, setName] = useState(zone.name);
  const [originUrl, setOriginUrl] = useState(zone.originUrl);
  const [error, setError] = useState<string | null>(null);
  const updateZone = useUpdateZone(zone.id);
  const deleteZone = useDeleteZone(zone.id);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = updateZoneSchema.safeParse({ name, originUrl });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors');
      return;
    }

    try {
      await updateZone.mutateAsync(parsed.data);
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Could not save zone') : 'Could not save zone';
      setError(message);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete zone "${zone.name}"? This cannot be undone.`)) return;
    await deleteZone.mutateAsync();
    router.push('/zones');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{zone.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-name">Name</Label>
            <Input id="zone-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zone-origin">Origin URL</Label>
            <Input id="zone-origin" value={originUrl} onChange={(e) => setOriginUrl(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={updateZone.isPending}>
            {updateZone.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <Button variant="destructive" onClick={handleDelete} disabled={deleteZone.isPending}>
          Delete zone
        </Button>
      </CardFooter>
    </Card>
  );
}
