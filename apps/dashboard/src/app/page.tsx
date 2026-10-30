import type { Metadata } from 'next';
import '@/components/marketing/marketing.css';
import { SiteHeader } from '@/components/marketing/site-header';
import { Hero } from '@/components/marketing/hero';
import { TrustStrip } from '@/components/marketing/trust-strip';
import { Container, SectionHeading } from '@/components/marketing/section-heading';
import { FeatureTabs } from '@/components/marketing/feature-tabs';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { UseCases } from '@/components/marketing/use-cases';
import { Developers } from '@/components/marketing/developers';
import { Performance } from '@/components/marketing/performance';
import { Testimonials } from '@/components/marketing/testimonials';
import { Faq } from '@/components/marketing/faq';
import { Contact } from '@/components/marketing/contact';
import { SiteFooter } from '@/components/marketing/site-footer';

export const metadata: Metadata = {
  title: 'RivoCloud: CDN, object storage and analytics in one console',
  description:
    'Cache your website at the edge, store files in S3-compatible buckets and see every request in real time. Instant purges, signed URLs, automatic TLS and team roles.',
};

export default function LandingPage() {
  return (
    <div className="marketing-root min-h-screen bg-background text-[15px] text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <Hero />
        <TrustStrip />

        <section id="products" aria-labelledby="products-title" className="bg-background py-20 sm:py-28">
          <Container>
            <SectionHeading
              id="products-title"
              kicker="Products"
              title="Three products, one console"
              lede="Websites, storage and analytics share the same edge network, the same team and the same API. Pick a product to see it in action."
            />
            <FeatureTabs />
          </Container>
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="bg-muted/70 py-20 sm:py-28">
          <Container>
            <SectionHeading
              id="how-title"
              kicker="How it works"
              title="From origin to edge in four steps"
              lede="Most teams are serving traffic through RivoCloud within an hour. Select a step to see what happens behind the scenes."
            />
            <HowItWorks />
          </Container>
        </section>

        <UseCases />
        <Developers />
        <Performance />

        <Testimonials />

        <section id="faq" aria-labelledby="faq-title" className="bg-background py-20 sm:py-28">
          <Container className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
            <SectionHeading
              className="lg:sticky lg:top-28 lg:self-start"
              id="faq-title"
              kicker="FAQ"
              title="Questions, answered"
              lede={
                <>
                  Something else on your mind?{' '}
                  <a href="#contact" className="font-medium text-primary underline-offset-4 hover:underline">
                    Ask our team
                  </a>
                  .
                </>
              }
            />
            <Faq />
          </Container>
        </section>

        <Contact />
      </main>
      <SiteFooter />
    </div>
  );
}
