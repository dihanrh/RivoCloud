import { Container } from './section-heading';
import { CountUp } from './count-up';

/** Fictional customer wordmarks, each with its own small glyph and type treatment. */
const LOGOS: Array<{ name: string; glyph: React.ReactNode; className: string }> = [
  {
    name: 'Acme Media',
    className: 'font-bold tracking-tight',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <path d="M12 3 22 20H2Z" fill="currentColor" />
        <path d="M12 10 16.5 18h-9Z" fill="#fff" />
      </svg>
    ),
  },
  {
    name: 'Northwind Shop',
    className: 'font-semibold',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 4 15 12 12 20 9 12Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: 'Lumen Labs',
    className: 'font-medium tracking-wide',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    name: 'Pinecrest',
    className: 'font-serif font-semibold italic',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <path d="M12 2 18 11h-3l4 6h-5v5h-4v-5H5l4-6H6Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: 'Orbitly',
    className: 'font-bold lowercase tracking-tight',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <ellipse cx="12" cy="12" rx="10" ry="4.5" fill="none" stroke="currentColor" strokeWidth="2" transform="rotate(-25 12 12)" />
        <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: 'Fieldnote',
    className: 'font-semibold tracking-tight',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <rect x="4" y="3" width="16" height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
];

const METRICS = [
  { value: 15, suffix: '', label: 'Edge locations on five continents' },
  { value: 2.4, decimals: 1, suffix: 'B', label: 'Requests served every day' },
  { value: 94, suffix: '%', label: 'Median cache hit ratio' },
  { value: 99.99, decimals: 2, suffix: '%', label: 'Edge uptime over the last 12 months' },
];

export function TrustStrip() {
  return (
    <section aria-labelledby="trust-title" className="border-y border-border bg-muted/60">
      <Container className="py-12 sm:py-14">
        <h2 id="trust-title" className="text-center text-[14px] font-medium text-muted-foreground">
          Trusted by teams who ship every day
        </h2>
        <ul className="mt-7 grid grid-cols-2 items-center gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
          {LOGOS.map((logo) => (
            <li key={logo.name} className="flex items-center justify-center gap-2 text-[#6b7280]">
              {logo.glyph}
              <span className={`text-[17px] ${logo.className}`}>{logo.name}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
          {METRICS.map((metric) => (
            <div key={metric.label} className="flex flex-col-reverse justify-end bg-background px-5 py-6 sm:px-7">
              <dt className="mt-1 text-[13px] leading-snug text-muted-foreground">{metric.label}</dt>
              <dd className="text-[30px] font-semibold tracking-tight text-foreground sm:text-[36px]">
                <CountUp value={metric.value} decimals={metric.decimals} suffix={metric.suffix} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-center text-[12px] text-muted-foreground">
          Customer names and figures on this page are illustrative.
        </p>
      </Container>
    </section>
  );
}
