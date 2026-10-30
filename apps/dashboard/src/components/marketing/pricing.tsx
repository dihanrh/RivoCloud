'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { DemoForm } from './demo-form';

type Billing = 'monthly' | 'yearly';

export const PLANS: Array<{
  name: string;
  monthly: number | null;
  blurb: string;
  cta: string;
  featured?: boolean;
  features: string[];
}> = [
  {
    name: 'Free',
    monthly: 0,
    blurb: 'For side projects and trying things out.',
    cta: 'Choose Free',
    features: [
      '2 websites',
      '100 GB bandwidth a month',
      '5 GB object storage',
      '7 days of analytics',
      '2 team seats',
      'Signed URLs and cache tag purges',
    ],
  },
  {
    name: 'Pro',
    monthly: 25,
    blurb: 'For growing products with real traffic.',
    cta: 'Choose Pro',
    featured: true,
    features: [
      '10 websites',
      '1 TB bandwidth a month',
      '250 GB object storage',
      '30 days of analytics',
      '5 team seats',
      'Custom domains with automatic TLS',
      'API keys with scopes',
    ],
  },
  {
    name: 'Business',
    monthly: 199,
    blurb: 'For teams that run their business on it.',
    cta: 'Choose Business',
    features: [
      '50 websites',
      '10 TB bandwidth a month',
      '2 TB object storage',
      '90 days of analytics',
      '25 team seats',
      'Full audit log',
      'Priority support, 99.95% uptime SLA',
    ],
  },
];

const YEARLY_DISCOUNT = 0.2;

export function priceFor(monthly: number, billing: Billing) {
  return billing === 'yearly' ? Math.round(monthly * (1 - YEARLY_DISCOUNT)) : monthly;
}

export function Pricing() {
  const [billing, setBilling] = useState<Billing>('monthly');
  const [plan, setPlan] = useState<string | null>(null);

  return (
    <>
      <div className="mt-10 flex justify-center">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-border bg-background p-1">
          {(['monthly', 'yearly'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={billing === option}
              onClick={() => setBilling(option)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[14px] font-medium transition-colors',
                billing === option ? 'bg-foreground text-white' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'monthly' ? 'Monthly' : 'Yearly'}
              {option === 'yearly' && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[11px] font-semibold',
                    billing === option ? 'bg-white/15 text-white' : 'bg-success-soft text-success',
                  )}
                >
                  Save 20%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-10 grid gap-6 lg:grid-cols-3">
        {PLANS.map((item) => {
          const price = priceFor(item.monthly ?? 0, billing);
          return (
            <li
              key={item.name}
              className={cn(
                'relative flex flex-col rounded-3xl border bg-background p-7',
                item.featured ? 'border-primary shadow-[0_30px_60px_-30px_rgba(214,36,106,0.45)]' : 'border-border',
              )}
            >
              {item.featured && (
                <span className="absolute -top-3 left-7 rounded-full bg-primary px-2.5 py-0.5 text-[12px] font-semibold text-primary-foreground">
                  Most popular
                </span>
              )}
              <h3 className="text-[18px] font-semibold text-foreground">{item.name}</h3>
              <p className="mt-1 text-[14px] text-muted-foreground">{item.blurb}</p>
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-[44px] font-semibold tracking-tight text-foreground tabular-nums" data-testid={`price-${item.name}`}>
                  ${price}
                </span>
                <span className="text-[14px] text-muted-foreground">/ month</span>
              </p>
              <p className="mt-1 h-5 text-[13px] text-muted-foreground">
                {item.monthly === 0
                  ? 'Free forever, no card needed'
                  : billing === 'yearly'
                    ? `Billed $${price * 12} a year`
                    : 'Billed monthly, cancel any time'}
              </p>
              <Button
                type="button"
                variant={item.featured ? 'default' : 'outline'}
                size="lg"
                className="mt-6 h-11 w-full text-[15px]"
                onClick={() => setPlan(item.name)}
              >
                {item.cta}
              </Button>
              <ul className="mt-7 space-y-3 border-t border-border pt-6">
                {item.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-[14px] text-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden strokeWidth={2.5} />
                    {feature}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex flex-col items-start gap-4 rounded-3xl border border-border bg-[linear-gradient(120deg,#fff7ef,#fdeef4_55%,#f3eefa)] p-7 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-[18px] font-semibold text-foreground">Enterprise</h3>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
            Custom bandwidth and storage commitments, longer analytics retention, a 99.99% uptime SLA and a named engineer
            who knows your setup.
          </p>
        </div>
        <Button type="button" variant="outline" size="lg" className="h-11 shrink-0 px-6 text-[15px]" onClick={() => setPlan('Enterprise')}>
          Talk to sales
        </Button>
      </div>
      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        Prices in US dollars, excluding tax. Extra bandwidth is $0.04 per GB and extra storage $0.015 per GB a month.
      </p>

      <Dialog open={plan !== null} onOpenChange={(open) => !open && setPlan(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{plan === 'Enterprise' ? 'Talk to our sales team' : `Get started on ${plan}`}</DialogTitle>
            <DialogDescription>
              Tell us a little about your project and we&apos;ll set up your workspace with you, usually within one business day.
            </DialogDescription>
          </DialogHeader>
          {plan && <DemoForm defaultPlan={plan} compact />}
        </DialogContent>
      </Dialog>
    </>
  );
}
