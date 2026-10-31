'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useCreateZone } from '@/hooks/use-create-zone';
import { errorMessage } from '@/lib/http';
import { createZoneSchema } from '@/lib/validation';

interface FieldErrors {
  name?: string;
  originUrl?: string;
}

/** Client-side checks, mirroring the API's rules with friendlier wording. */
export function validateNewWebsite(name: string, originUrl: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!name) errors.name = 'Enter a name.';
  else if (name.length > 54) errors.name = 'Use 54 characters or fewer.';
  if (!originUrl) errors.originUrl = 'Enter the URL of your origin server.';
  else if (!/^https?:\/\//i.test(originUrl) || !createZoneSchema.shape.originUrl.safeParse(originUrl).success) {
    errors.originUrl = 'Enter a full http(s) URL, for example https://origin.example.com.';
  }
  return errors;
}

/**
 * "Add a website" dialog. Uncontrolled with its own trigger by default; pass
 * `open` + `onOpenChange` (and `trigger={null}`) to drive it from elsewhere,
 * e.g. the `?create=1` deep link.
 */
export function CreateZoneDialog({
  open: openProp,
  onOpenChange,
  trigger,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactElement | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const [name, setName] = useState('');
  const [originUrl, setOriginUrl] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const createZone = useCreateZone();

  function setOpen(next: boolean) {
    if (!next && createZone.isPending) return;
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
    if (!next) {
      setName('');
      setOriginUrl('');
      setErrors({});
      setFormError(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const trimmedName = name.trim();
    const trimmedOrigin = originUrl.trim();
    const found = validateNewWebsite(trimmedName, trimmedOrigin);
    setErrors(found);
    if (found.name || found.originUrl) return;

    try {
      const zone = await createZone.mutateAsync({ name: trimmedName, originUrl: trimmedOrigin });
      toast.success('Website added', `${zone.name} is ready. Its edge hostname works right away.`);
      setOpen(false);
      router.push(`/zones/${zone.id}`);
    } catch (err) {
      setFormError(errorMessage(err, 'Could not add the website. Check the origin URL and try again.'));
    }
  }

  const defaultTrigger = <Button leftIcon={<Plus />}>Add a website</Button>;
  const triggerEl = trigger === undefined ? defaultTrigger : trigger;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerEl && <DialogTrigger asChild>{triggerEl}</DialogTrigger>}
      <DialogContent preventClose={createZone.isPending}>
        <DialogForm onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Add a website</DialogTitle>
            <DialogDescription>
              We fetch content from your origin and cache it at the edge. You get an edge hostname right away and can add
              custom domains later.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Name" hint="Used in the edge hostname. Letters, numbers, and dashes work best." error={errors.name}>
              <Input
                placeholder="my-blog"
                value={name}
                autoFocus
                autoComplete="off"
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((x) => ({ ...x, name: undefined }));
                }}
                maxLength={54}
                disabled={createZone.isPending}
              />
            </Field>
            <Field label="Origin URL" hint="The server we fetch your content from." error={errors.originUrl}>
              <Input
                type="url"
                placeholder="https://origin.example.com"
                value={originUrl}
                autoComplete="off"
                onChange={(e) => {
                  setOriginUrl(e.target.value);
                  if (errors.originUrl) setErrors((x) => ({ ...x, originUrl: undefined }));
                }}
                disabled={createZone.isPending}
              />
            </Field>
            {formError && <ErrorBanner>{formError}</ErrorBanner>}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={createZone.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={createZone.isPending}>
              Add website
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
