import { FileClock, Gauge, KeyRound } from 'lucide-react';
import { Container, SectionHeading } from './section-heading';
import { CodeSamples } from './code-samples';

const SCOPES = ['zone:read', 'zone:write', 'cache:invalidate', 'storage:read', 'storage:write', 'analytics:read'];

const POINTS = [
  {
    icon: KeyRound,
    title: 'API keys with scopes',
    body: 'Give each script only what it needs. A deploy job that purges the cache never has to be able to delete a bucket.',
  },
  {
    icon: FileClock,
    title: 'An audit log for every change',
    body: 'Changes made with a key are recorded with the key’s name, next to the ones your team makes in the console.',
  },
  {
    icon: Gauge,
    title: 'Predictable limits',
    body: 'Sensitive endpoints such as purges are rate limited, and return a clear 429 when you need to slow down.',
  },
];

export function Developers() {
  return (
    <section id="developers" aria-labelledby="developers-title" className="relative overflow-hidden bg-[#0f1115] py-20 text-white sm:py-28">
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: 'var(--brand-gradient)' }}
        aria-hidden
      />
      <Container className="relative">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
          <div>
            <SectionHeading
              id="developers-title"
              tone="dark"
              kicker="Developers"
              title="Everything in the console is an API call"
              lede="A REST API at /api/v1 covers websites, cache rules, purges, buckets, objects and analytics. A JavaScript SDK and a CLI are in preview."
            />
            <ul className="mt-10 space-y-7">
              {POINTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                    <Icon className="h-5 w-5 text-[#ff8fb5]" aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-[16px] font-semibold text-white">{title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-[#b7bcc6]">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <p className="text-[13px] font-medium text-[#b7bcc6]">Available scopes include</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {SCOPES.map((scope) => (
                  <li key={scope} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[12px] text-[#e6e8ec]">
                    {scope}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="min-w-0 lg:sticky lg:top-28 lg:self-start lg:pt-4">
            <CodeSamples />
            <p className="mt-4 text-[13px] text-[#9aa1ad]">
              Authenticate with an <span className="font-mono text-[#e6e8ec]">X-API-Key</span> header. Keys start with{' '}
              <span className="font-mono text-[#e6e8ec]">rc_live_</span> or <span className="font-mono text-[#e6e8ec]">rc_test_</span>.
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
