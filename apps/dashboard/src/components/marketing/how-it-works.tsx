'use client';

import { useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ArchitectureDiagram, type ArchLink, type ArchNode } from './illustrations/architecture-diagram';

export const STEPS: Array<{
  title: string;
  body: string;
  detail: string;
  nodes: ArchNode[];
  links: ArchLink[];
}> = [
  {
    title: 'Add your website',
    body: 'Give it a name and your origin URL. RivoCloud creates a pull zone and sends its settings to every edge.',
    detail: 'The console saves the website and publishes its config to the edges, which will fetch from your origin on a miss.',
    nodes: ['console', 'edge', 'origin', 'bus'],
    links: ['console-bus', 'bus-edge', 'edge-origin'],
  },
  {
    title: 'Point your DNS',
    body: 'Create one CNAME record. We verify it and issue a TLS certificate automatically, then visitors start arriving at the nearest edge.',
    detail: 'Visitors resolve your domain through DNS and connect to the closest edge location over HTTPS.',
    nodes: ['visitors', 'dns', 'edge'],
    links: ['visitor-dns', 'dns-edge', 'visitor-edge'],
  },
  {
    title: 'Cache, purge and protect',
    body: 'Edges answer from memory, then Redis, then your origin. Purges travel over the message bus and reach every edge in seconds.',
    detail: 'Requests are served from L1 memory or L2 Redis. A purge from the console fans out over the message bus to every edge.',
    nodes: ['l1', 'l2', 'console', 'bus', 'edges'],
    links: ['visitor-edge', 'console-bus', 'bus-edge', 'bus-edges'],
  },
  {
    title: 'Watch your traffic',
    body: 'Every request is recorded. Hit ratio, latency, status codes and countries show up in the console within seconds.',
    detail: 'Each edge streams request logs to the analytics store, which powers the charts in the console.',
    nodes: ['visitors', 'edge', 'analytics'],
    links: ['visitor-edge', 'edge-analytics'],
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const step = STEPS[active];

  const move = (index: number) => {
    const next = (index + STEPS.length) % STEPS.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(active + 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(active - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(STEPS.length - 1);
    }
  };

  return (
    <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <div role="tablist" aria-label="Setup steps" aria-orientation="vertical" className="flex flex-col gap-2">
        {STEPS.map((item, index) => {
          const selected = index === active;
          return (
            <button
              key={item.title}
              ref={(node) => {
                refs.current[index] = node;
              }}
              id={`${baseId}-step-${index}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-diagram`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onMouseEnter={() => setActive(index)}
              onKeyDown={onKeyDown}
              className={cn(
                'group relative flex gap-4 rounded-2xl border p-5 text-left transition-[background-color,border-color,box-shadow]',
                selected
                  ? 'border-border bg-background shadow-[0_16px_40px_-24px_rgba(29,32,37,0.35)]'
                  : 'border-transparent hover:bg-background/60',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold transition-colors',
                  selected ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground ring-1 ring-border',
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[17px] font-semibold text-foreground">{item.title}</span>
                <span className="mt-1 block text-[15px] leading-relaxed text-muted-foreground">
                  {item.body}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        id={`${baseId}-diagram`}
        role="tabpanel"
        aria-labelledby={`${baseId}-step-${active}`}
        className="order-first rounded-3xl border border-border bg-background p-4 shadow-[0_24px_60px_-36px_rgba(29,32,37,0.35)] sm:p-6 lg:order-last lg:sticky lg:top-28 lg:self-start"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-muted-foreground">
            Step {active + 1} of {STEPS.length}
          </p>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> Active path
          </span>
        </div>
        <div className="mt-3">
          <ArchitectureDiagram activeNodes={step.nodes} activeLinks={step.links} label={`${step.title}: ${step.detail}`} />
        </div>
        <p key={active} className="mk-fade-up mt-4 rounded-xl bg-muted px-4 py-3 text-[14px] leading-relaxed text-foreground">
          {step.detail}
        </p>
      </div>
    </div>
  );
}
