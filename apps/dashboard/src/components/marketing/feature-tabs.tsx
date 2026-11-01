'use client';

import { useId, useRef, useState } from 'react';
import { BarChart3, Check, Globe2, HardDrive, Link2, ShieldCheck, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AnalyticsMockup,
  CacheRulesMockup,
  DomainsMockup,
  SignedUrlMockup,
  StorageMockup,
  TeamsMockup,
} from './illustrations/feature-mockups';
import { useTourCommand } from './tour/tour-bus';

export const FEATURES = [
  {
    id: 'caching',
    label: 'Websites & caching',
    icon: Globe2,
    title: 'Cache your site at the edge, on your terms',
    body: 'Add a website by pointing RivoCloud at your origin. Every edge answers from memory first, then a shared Redis layer, and only goes back to your server when it has to.',
    points: [
      'Per-path rules: cache, bypass or no-store, with separate edge and browser TTLs',
      'Choose whether query strings are part of the cache key',
      'Purge by path pattern or cache tag; every edge drops it within seconds',
      'Three cache layers keep origin traffic to a trickle',
    ],
    Mockup: CacheRulesMockup,
  },
  {
    id: 'storage',
    label: 'Object storage',
    icon: HardDrive,
    title: 'Buckets for every file your product touches',
    body: 'S3-compatible storage that lives next to your CDN. Uploads go straight from the browser to storage, so large files never pass through your API servers.',
    points: [
      'Presigned uploads: bytes go directly to storage, not through the API',
      'Public or private buckets, switchable at any time',
      'Serve a bucket through one of your websites to cache it at the edge',
      'Share a single file with a time-limited link',
    ],
    Mockup: StorageMockup,
  },
  {
    id: 'signed-urls',
    label: 'Signed URLs',
    icon: Link2,
    title: 'Private content with links that expire',
    body: 'Turn on signed URLs for a website and every request must carry a valid HMAC-SHA256 signature and an expiry time. The edge checks both before it serves a byte.',
    points: [
      'Generate links from the console, the API or your own backend',
      'Set an expiry from minutes to days',
      'Changing the path or expiry breaks the signature',
      'Rotate the signing secret without downtime',
    ],
    Mockup: SignedUrlMockup,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: BarChart3,
    title: 'See every request, not a sample',
    body: 'Requests, bandwidth, cache hit ratio and latency for one website or your whole account, stored in a columnar database built for fast queries over billions of rows.',
    points: [
      'Latency at p50, p95 and p99',
      'Status codes, top paths and visitor countries',
      'Filter by website or look across the whole account',
      'Ranges from the last hour to the last 90 days',
    ],
    Mockup: AnalyticsMockup,
  },
  {
    id: 'domains',
    label: 'Custom domains & TLS',
    icon: ShieldCheck,
    title: 'Your domain, with HTTPS handled for you',
    body: 'Add a domain, create one DNS record, and RivoCloud verifies it and issues a Let’s Encrypt certificate automatically. Renewals happen on their own.',
    points: [
      'Clear verification states, from waiting for DNS to active',
      'Certificates issued and renewed automatically',
      'Several domains per website',
      'HTTPS on every edge location',
    ],
    Mockup: DomainsMockup,
  },
  {
    id: 'teams',
    label: 'Teams & security',
    icon: Users,
    title: 'Give everyone exactly the access they need',
    body: 'Invite your team with Owner, Admin, Developer or Viewer roles. Automations get API keys limited to the scopes they use, and every change lands in the audit log.',
    points: [
      'Four roles with clear, predictable permissions',
      'API keys with scopes like zone:read and cache:invalidate',
      'An audit log of who changed what, and when',
      'Rate limiting on sensitive actions such as purges',
    ],
    Mockup: TeamsMockup,
  },
] as const;

export function FeatureTabs() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();

  useTourCommand('products', (id) => {
    const index = FEATURES.findIndex((feature) => feature.id === id);
    if (index < 0) return;
    setActive(index);
    // Keep the selected pill visible in the horizontally scrolling strip on phones.
    const tab = tabRefs.current[index];
    const list = tab?.parentElement;
    if (tab && list && list.scrollWidth > list.clientWidth) {
      const offset = tab.getBoundingClientRect().left - list.getBoundingClientRect().left - 16;
      list.scrollLeft += offset;
    }
  });

  const select = (index: number) => {
    const next = (index + FEATURES.length) % FEATURES.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        select(active + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        select(active - 1);
        break;
      case 'Home':
        event.preventDefault();
        select(0);
        break;
      case 'End':
        event.preventDefault();
        select(FEATURES.length - 1);
        break;
    }
  };

  return (
    <div className="mt-10 sm:mt-12" data-tour="products-panel">
      <div
        role="tablist"
        aria-label="Products"
        aria-orientation="horizontal"
        data-tour="products-tabs"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {FEATURES.map((feature, index) => {
          const Icon = feature.icon;
          const selected = index === active;
          return (
            <button
              key={feature.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${baseId}-tab-${feature.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${feature.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={onKeyDown}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[14px] font-medium transition-colors',
                selected
                  ? 'border-foreground bg-foreground text-white'
                  : 'border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground',
              )}
            >
              <Icon className={cn('h-4 w-4', selected ? 'text-[#ff8fb5]' : 'text-muted-foreground')} aria-hidden />
              {feature.label}
            </button>
          );
        })}
      </div>

      {FEATURES.map((feature, index) => {
        const { Mockup } = feature;
        const selected = index === active;
        return (
          <div
            key={feature.id}
            id={`${baseId}-panel-${feature.id}`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${feature.id}`}
            hidden={!selected}
            tabIndex={0}
            className="mt-8 rounded-3xl border border-border bg-[linear-gradient(160deg,#ffffff_30%,#fdf2f6)] p-5 focus-visible:outline-offset-4 sm:p-8 lg:p-10"
          >
            {selected && (
              <div className="mk-fade-up grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
                <div>
                  <h3 className="text-[24px] font-semibold leading-tight tracking-tight text-foreground sm:text-[28px]">
                    {feature.title}
                  </h3>
                  <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">{feature.body}</p>
                  <ul className="mt-6 space-y-3">
                    {feature.points.map((point) => (
                      <li key={point} className="flex gap-3 text-[15px] text-foreground">
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft">
                          <Check className="h-3 w-3 text-primary" aria-hidden strokeWidth={3} />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="min-w-0">
                  <Mockup />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
