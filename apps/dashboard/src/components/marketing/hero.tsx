import { ArrowDown, ShieldCheck, Zap, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from './section-heading';
import { EdgeNetworkIllustration, EdgeStatusList, LiveStatsCard, PurgeToast } from './illustrations/edge-network';

const HIGHLIGHTS = [
  { icon: Zap, text: 'Purges reach every edge in seconds' },
  { icon: Database, text: 'S3-compatible storage built in' },
  { icon: ShieldCheck, text: 'Automatic TLS and signed URLs' },
];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div className="mk-hero-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="mk-grid-fade pointer-events-none absolute inset-0" aria-hidden />
      <Container className="relative pt-14 pb-16 sm:pt-20 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href="#products"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-white/80 py-1 pr-3 pl-1 text-[13px] text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-border-strong hover:text-foreground"
          >
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary">New</span>
            Cache tags and signed URLs on every plan
          </a>
          <h1
            id="hero-title"
            className="mt-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-foreground sm:text-[56px] lg:text-[68px]"
          >
            Your website, your files and your traffic, <span className="mk-gradient-text">served from the edge</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            RivoCloud puts a global cache in front of your site, stores your files in S3-compatible buckets and shows you
            every request in real time. One console, one API, no glue code.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 w-full px-6 text-[15px] sm:w-auto">
              <a href="#contact">Request a demo</a>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 w-full px-6 text-[15px] sm:w-auto">
              <a href="#how-it-works">
                See how it works
                <ArrowDown aria-hidden />
              </a>
            </Button>
          </div>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="inline-flex items-center gap-1.5">
                <Icon className="h-4 w-4 text-primary" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto mt-14 max-w-[1100px] sm:mt-16">
          <div
            className="absolute -inset-px rounded-[22px] opacity-60 blur-2xl"
            style={{ background: 'var(--brand-gradient)' }}
            aria-hidden
          />
          <div className="relative overflow-hidden rounded-[20px] border border-border bg-white shadow-[0_40px_80px_-40px_rgba(29,32,37,0.45)]">
            <div className="flex items-center gap-2 border-b border-border bg-muted/80 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#e5e7eb]" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-[#e5e7eb]" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-[#e5e7eb]" aria-hidden />
              <p className="ml-3 truncate text-[12px] font-medium text-muted-foreground">Edge network · live traffic</p>
              <span className="ml-auto hidden items-center gap-3 text-[12px] text-muted-foreground sm:flex">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                  Request
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-brand-orange" aria-hidden />
                  Cache miss to origin
                </span>
              </span>
            </div>
            <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="relative bg-[linear-gradient(180deg,#ffffff,#fbf8fb)] px-2 pt-6 pb-4 sm:px-6 sm:pt-10 sm:pb-8">
                <EdgeNetworkIllustration />
                <div className="mk-float absolute bottom-6 left-6 hidden lg:block">
                  <PurgeToast className="w-[290px]" />
                </div>
              </div>
              <aside
                aria-label="Live traffic summary"
                className="flex flex-col gap-3 border-t border-border bg-muted/60 p-4 sm:p-5 lg:border-t-0 lg:border-l"
              >
                <LiveStatsCard className="w-full shadow-sm" />
                <EdgeStatusList />
                <PurgeToast className="w-full shadow-sm lg:hidden" />
              </aside>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
