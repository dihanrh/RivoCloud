import { CalendarClock, MessagesSquare, Route } from 'lucide-react';
import { Container } from './section-heading';
import { DemoForm } from './demo-form';

const AGENDA = [
  { icon: Route, text: 'A walkthrough of your setup: origin, domains, buckets and cache rules' },
  { icon: MessagesSquare, text: 'Answers from an engineer, not a script' },
  { icon: CalendarClock, text: '30 minutes, at a time that suits you' },
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
      <text x="55" y="108.5" textAnchor="middle" fontSize="9" fontWeight="600" fill="#b51b58">30 min</text>
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

export function Contact() {
  return (
    <section id="contact" aria-labelledby="contact-title" className="relative overflow-hidden bg-muted/70 py-20 sm:py-28">
      <div className="mk-hero-glow pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <Container className="relative">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <h2 id="contact-title" className="text-[32px] font-semibold leading-[1.1] tracking-tight text-balance text-foreground sm:text-[44px]">
              See RivoCloud with your own traffic
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
              Book a demo and we&apos;ll show you how your site, files and analytics would look on RivoCloud, and help you plan
              the move.
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
          <div className="rounded-3xl border border-border bg-background p-6 shadow-[0_30px_60px_-36px_rgba(29,32,37,0.35)] sm:p-8">
            <h3 className="text-[20px] font-semibold text-foreground">Request a demo</h3>
            <p className="mt-1 mb-6 text-[14px] text-muted-foreground">We reply within one business day.</p>
            <DemoForm />
          </div>
        </div>
      </Container>
    </section>
  );
}
