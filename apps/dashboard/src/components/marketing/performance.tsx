import { Container, SectionHeading } from './section-heading';
import { PerformanceChart } from './performance-chart';

const LATENCY = [
  { label: 'p50', value: 18, width: 18 },
  { label: 'p95', value: 41, width: 41 },
  { label: 'p99', value: 87, width: 87 },
];

const PATHS = [
  ['/static/app.js', '21.4%'],
  ['/products/*', '17.9%'],
  ['/images/hero.webp', '9.3%'],
  ['/api/cart', '4.1%'],
];

export function Performance() {
  return (
    <section aria-labelledby="performance-title" className="bg-muted/70 py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="performance-title"
          kicker="Analytics"
          title="Know how fast you are, everywhere"
          lede="Every request is logged at the edge and queryable within seconds. Switch between metrics and ranges below to explore sample traffic from a busy online store."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <PerformanceChart />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-3xl border border-border bg-background p-6">
              <h3 className="text-[15px] font-semibold text-foreground">Response time at the edge</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">Time to first byte, last 24 hours</p>
              <ul className="mt-5 space-y-4">
                {LATENCY.map((row) => (
                  <li key={row.label}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="font-mono font-medium text-foreground">{row.label}</span>
                      <span className="font-semibold text-foreground tabular-nums">{row.value} ms</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${row.width}%`, background: 'var(--brand-gradient)' }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl border border-border bg-background p-6">
              <h3 className="text-[15px] font-semibold text-foreground">Top paths</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">Share of all requests</p>
              <ul className="mt-4 divide-y divide-border text-[13px]">
                {PATHS.map(([path, share]) => (
                  <li key={path} className="flex items-center justify-between py-2.5">
                    <span className="truncate font-mono text-foreground">{path}</span>
                    <span className="ml-3 text-muted-foreground tabular-nums">{share}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-4 text-[12px] text-muted-foreground">Sample data for illustration.</p>
      </Container>
    </section>
  );
}
