import Link from 'next/link';
import { ArrowRight, Globe2, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from './section-heading';
import { CountUp } from './count-up';

const AGENDA = [
  { icon: Globe2, text: 'A seeded console with websites, cache rules, buckets and analytics' },
  { icon: Users, text: 'Four roles to try: owner, admin, developer and viewer' },
  { icon: ShieldCheck, text: 'Runs in your browser, with no card and nothing to install' },
];

const METRICS = [
  { value: 72.4, decimals: 1, suffix: 'B', label: 'Requests served', delta: '+14%' },
  { value: 1.3, decimals: 1, suffix: ' PB', label: 'Bandwidth saved by cache', delta: '+9%' },
  { value: 18, suffix: ' ms', label: 'Median time to first byte', delta: '-3 ms' },
  { value: 3200, suffix: '+', label: 'Websites on the network', delta: '+210' },
  { value: 41, suffix: ' TB', label: 'Files stored in buckets', delta: '+6%' },
  { value: 150, prefix: '<', suffix: ' ms', label: 'Global cache purge', delta: '-20 ms' },
];

function ContactArt() {
  return (
    <svg viewBox="0 0 360 140" className="h-auto w-full max-w-[360px]" aria-hidden>
      <defs>
        <linearGradient id="mk-contact-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7931e" />
          <stop offset="0.55" stopColor="#e8336d" />
          <stop offset="1" stopColor="#5b2a8c" />
        </linearGradient>
      </defs>
      <rect x="8" y="16" width="200" height="108" rx="14" fill="#ffffff" stroke="#d9dce1" />
      <rect x="8" y="16" width="200" height="30" rx="14" fill="url(#mk-contact-grad)" />
      <rect x="8" y="34" width="200" height="12" fill="url(#mk-contact-grad)" />
      <text x="24" y="36" fontSize="11" fontWeight="600" fill="#ffffff">Demo with RivoCloud</text>
      <rect x="24" y="60" width="96" height="8" rx="4" fill="#1d2025" />
      <rect x="24" y="76" width="140" height="6" rx="3" fill="#d9dce1" />
      <rect x="24" y="96" width="62" height="18" rx="9" fill="#fde8f0" />
      <text x="55" y="108.5" textAnchor="middle" fontSize="9" fontWeight="600" fill="#b51b58">Live</text>
      <g transform="translate(222 34)">
        <circle cx="34" cy="34" r="34" fill="#fde8f0" />
        <circle cx="34" cy="28" r="11" fill="#d6246a" />
        <path d="M14 58a20 16 0 0 1 40 0z" fill="#d6246a" />
        <circle cx="96" cy="62" r="24" fill="#efe8f7" />
        <circle cx="96" cy="58" r="8" fill="#5b2a8c" />
        <path d="M82 80a14 11 0 0 1 28 0z" fill="#5b2a8c" />
      </g>
    </svg>
  );
}

export function NetworkMetrics() {
  return (
    <section id="metrics" aria-labelledby="contact-title" className="relative overflow-hidden bg-muted/70 py-20 sm:py-28">
      <div className="mk-hero-glow pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <Container className="relative">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <h2 id="contact-title" className="text-[32px] font-semibold leading-[1.1] tracking-tight text-balance text-foreground sm:text-[44px]">
              The network, by the numbers
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
              Every website, bucket and cache rule adds to the same global network. Open the demo console to see the same
              numbers for a single account.
            </p>
            <ul className="mt-8 space-y-4">
              {AGENDA.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-[15px] text-foreground">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
                    <Icon className="h-4 w-4 text-primary" aria-hidden />
                  </span>
                  <span className="pt-1">{text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-10 hidden lg:block">
              <ContactArt />
            </div>
          </div>
          <div className="self-center rounded-3xl border border-border bg-background p-6 shadow-[0_30px_60px_-36px_rgba(29,32,37,0.35)] sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[20px] font-semibold text-foreground">Network metrics</h3>
                <p className="mt-1 text-[14px] text-muted-foreground">Last 30 days, across every edge location.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[12px] font-medium text-primary-hover">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
                Live
              </span>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
              {METRICS.map((metric) => (
                <div key={metric.label} className="flex flex-col-reverse justify-end bg-background px-4 py-5 sm:px-5">
                  <dt className="mt-1 text-[13px] leading-snug text-muted-foreground">{metric.label}</dt>
                  <dd className="text-[26px] font-semibold tracking-tight text-foreground sm:text-[30px]">
                    <CountUp value={metric.value} decimals={metric.decimals} prefix={metric.prefix} suffix={metric.suffix} />
                    <span className="mt-1 flex items-center gap-1 text-[12px] font-medium tracking-normal text-success">
                      <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                      {metric.delta}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-muted-foreground">Figures are illustrative demo data.</p>
              <Button asChild size="sm">
                <Link href="/login?demo=1">
                  Open the demo console
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
