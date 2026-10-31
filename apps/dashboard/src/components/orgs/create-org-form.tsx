'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useCreateOrg } from '@/hooks/use-create-org';
import { errorMessage } from '@/lib/http';
import { createOrgSchema } from '@/lib/validation';

export function CreateOrgForm() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createOrg = useCreateOrg();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createOrgSchema.safeParse({ name: name.trim() });
    if (!parsed.success) {
      setNameError('Enter an account name.');
      return;
    }
    setNameError(null);

    try {
      await createOrg.mutateAsync(parsed.data);
      router.push('/dashboard');
    } catch (err) {
      const message = errorMessage(err, 'Could not create the account. Try again.');
      setError(message);
      toast.error('Could not create the account', message);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Account name" hint="Usually your company or team. You can invite people afterwards." error={nameError} required>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          placeholder="Acme Inc"
          autoComplete="organization"
          autoFocus
        />
      </Field>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Button type="submit" size="lg" loading={createOrg.isPending} className="w-full">
        Create account
      </Button>
    </form>
  );
}
