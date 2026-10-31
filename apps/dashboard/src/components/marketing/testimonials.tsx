import { Container, SectionHeading } from './section-heading';

const QUOTES = [
  {
    quote:
      'Our product pages used to fall over every time we ran a sale. Now 95% of requests never reach our servers, and when prices change we purge one path from the admin and it is live everywhere before the page reloads.',
    name: 'Jane Doe',
    role: 'Head of engineering, Northwind Shop',
    initials: 'JD',
    color: '#f7931e',
  },
  {
    quote:
      'We moved 30 TB of images and video into RivoCloud buckets in a weekend. Cache tags mean an editor’s correction is visible in seconds, not after a TTL runs out.',
    name: 'John Smith',
    role: 'Platform lead, Acme Media',
    initials: 'JS',
    color: '#e8336d',
  },
  {
    quote:
      'Presigned uploads and signed links replaced a file service we had been maintaining for three years. Our CI key can purge the cache and nothing else, which our security team loves.',
    name: 'Alex Johnson',
    role: 'CTO, Lumen Labs',
    initials: 'AJ',
    color: '#5b2a8c',
  },
];

export function Testimonials() {
  return (
    <section aria-labelledby="testimonials-title" className="border-y border-border bg-muted/70 py-20 sm:py-28">
      <Container>
        <SectionHeading
          id="testimonials-title"
          align="center"
          kicker="Customers"
          title="Teams ship faster with RivoCloud"
        />
        <ul data-tour="testimonials" className="mt-12 grid gap-6 lg:grid-cols-3">
          {QUOTES.map((item) => (
            <li key={item.name} className="flex">
              <figure className="flex flex-col justify-between rounded-3xl border border-border bg-background p-7">
                <svg viewBox="0 0 32 24" className="h-6 w-8" aria-hidden>
                  <path
                    d="M0 24V14C0 6 4 1 12 0l1 4c-4 1-6 4-6 8h5v12Zm19 0V14c0-8 4-13 12-14l1 4c-4 1-6 4-6 8h5v12Z"
                    fill={item.color}
                    fillOpacity="0.85"
                  />
                </svg>
                <blockquote className="mt-5 flex-1 text-[16px] leading-relaxed text-foreground">{item.quote}</blockquote>
                <figcaption className="mt-7 flex items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white"
                    style={{ background: item.color === '#f7931e' ? '#b35f00' : item.color === '#e8336d' ? '#d6246a' : item.color }}
                    aria-hidden
                  >
                    {item.initials}
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold text-foreground">{item.name}</span>
                    <span className="block text-[13px] text-muted-foreground">{item.role}</span>
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
