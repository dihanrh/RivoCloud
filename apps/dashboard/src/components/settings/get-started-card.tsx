'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { useApiKeys } from '@/hooks/use-api-keys';
import { useBuckets } from '@/hooks/use-buckets';
import { useMembers } from '@/hooks/use-members';
import { useZones } from '@/hooks/use-zones';
import { canManageMembers } from '@/lib/rbac';
import type { OrgRole } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Step {
  id: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
}

const storageKey = (orgId: string) => `rc.getStarted.dismissed.${orgId}`;

/**
 * "Get started" checklist for a new account. Each step links to the command palette's
 * quick-action URL, so the right dialog opens on arrival. Hidden once every step is done,
 * when dismissed (remembered per account), and for read-only roles.
 */
export function GetStartedCard({ orgId, role }: { orgId: string; role: OrgRole | null }) {
  const canWrite = !!role && role !== 'viewer';
  const zones = useZones();
  const buckets = useBuckets();
  const members = useMembers(orgId);
  const keys = useApiKeys();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey(orgId)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [orgId]);

  if (!canWrite || dismissed) return null;
  // A failed members load only drops the invite step; the other lists are required.
  if (!zones.data || !buckets.data || !keys.data || (!members.data && !members.isError)) return null;

  const steps: Step[] = [
    {
      id: 'website',
      title: 'Add a website',
      description: 'Point RivoCloud at your origin and serve it from the edge.',
      href: '/zones?create=1',
      done: zones.data.zones.length > 0,
    },
    {
      id: 'bucket',
      title: 'Create a bucket',
      description: 'Store files and share them with signed links.',
      href: '/storage?create=1',
      done: buckets.data.buckets.length > 0,
    },
    ...(canManageMembers(role) && members.data
      ? [
          {
            id: 'invite',
            title: 'Invite a teammate',
            description: 'Give your team access with the right role.',
            href: '/settings/members?invite=1',
            done: members.data.length > 1,
          },
        ]
      : []),
    {
      id: 'key',
      title: 'Create an API key',
      description: 'Automate deploys and cache purges from CI.',
      href: '/settings/api-keys?create=1',
      done: keys.data.length > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey(orgId), '1');
    } catch {
      // Private mode: the card just comes back next visit.
    }
  }

  return (
    <Card role="region" className="relative overflow-hidden" aria-labelledby="get-started-heading">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-[image:var(--brand-gradient)]" aria-hidden />
      <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
        <div>
          <h2 id="get-started-heading" className="text-base font-semibold">
            Get started
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {doneCount} of {steps.length} done. Finish setting up your account.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-muted sm:block"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={doneCount}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <Tooltip content="Dismiss">
            <Button variant="ghost" size="icon-sm" aria-label="Dismiss get started" onClick={dismiss}>
              <X />
            </Button>
          </Tooltip>
        </div>
      </div>
      <ol className={cn('grid gap-px border-t border-border bg-border sm:grid-cols-2', steps.length === 4 && 'lg:grid-cols-4', steps.length === 3 && 'lg:grid-cols-3')}>
        {steps.map((step, i) => (
          <li key={step.id} className="bg-background">
            {step.done ? (
              <div className="flex h-full items-start gap-3 p-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden>
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-muted-foreground line-through decoration-border-strong">{step.title}</p>
                  <p className="sr-only">Done</p>
                </div>
              </div>
            ) : (
              <Link href={step.href} className="group flex h-full items-start gap-3 p-4 transition-colors hover:bg-muted">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-xs font-semibold text-muted-foreground" aria-hidden>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-[13px] font-semibold group-hover:text-primary">
                    {step.title}
                    <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                </div>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
