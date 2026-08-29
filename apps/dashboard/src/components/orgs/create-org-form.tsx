'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOrgSchema } from '@/lib/validation';
import { useCreateOrg } from '@/hooks/use-create-org';
import { useSelectOrg } from '@/hooks/use-select-org';
import { ApiError } from '@/lib/http';

export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createOrg = useCreateOrg();
  const selectOrg = useSelectOrg();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createOrgSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter an organization name');
      return;
    }

    try {
      const { organization } = await createOrg.mutateAsync(parsed.data);
      await selectOrg.mutateAsync(organization.id);
      router.push('/dashboard');
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Could not create organization') : 'Could not create organization';
      setError(message);
    }
  }

  const submitting = createOrg.isPending || selectOrg.isPending;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-name">Organization name</Label>
        <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
