'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Activity, CheckCircle2, HardDrive, Zap } from 'lucide-react';
import { useReducedMotion } from '@/components/marketing/use-reduced-motion';
import { cn } from '@/lib/utils';

/** Mark + white wordmark, for the dark brand surfaces. */
export function AuthLogo({ size = 'lg', className }: { size?: 'sm' | 'lg'; className?: string }) {
  const mark = size === 'lg' ? 48 : 30;
  return (
    <Link
      href="/"
      aria-label="RivoCloud home"
      className={cn('inline-flex items-center rounded-md', size === 'lg' ? 'gap-3' : 'gap-2', className)}
    >
      <Image src="/brand/rivocloud-mark.png" alt="" width={mark} height={mark} priority />
      <span className={cn('font-semibold tracking-tight text-white', size === 'lg' ? 'text-[26px]' : 'text-[17px]')}>
        RivoCloud
      </span>
    </Link>
  );
}

/** The blurred orange / pink / purple glow behind the dark brand surfaces. */
export function BrandAtmosphere({ compact = false }: { compact?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className={cn(
          'absolute rounded-full bg-brand-orange blur-[90px]',
          compact ? '-left-10 -top-16 h-40 w-48 opacity-45' : '-left-40 -top-40 h-[380px] w-[380px] opacity-55',
        )}
      />
      <div
        className={cn(
          'absolute rounded-full bg-brand-pink blur-[100px]',
          compact ? 'left-1/4 -top-10 h-40 w-72 opacity-60' : 'right-[-140px] top-[18%] h-[480px] w-[480px] opacity-55',
        )}
      />
      <div
        className={cn(
          'absolute rounded-full bg-brand-purple opacity-70 blur-[110px]',
          compact ? '-right-10 -bottom-20 h-40 w-72' : '-bottom-40 left-[10%] h-[480px] w-[520px]',
        )}
      />
      {!compact && (
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'radial-gradient(ellipse at 30% 20%, #000 0%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 30% 20%, #000 0%, transparent 70%)',
          }}
        />
      )}
    </div>
  );
}

const PROOF_POINTS = [
  {
    icon: Zap,
    title: 'Edge caching with instant purge',
    body: 'Per-path cache rules, and purges that land everywhere in seconds.',
  },
  {
    icon: HardDrive,
    title: 'S3-compatible object storage',
    body: 'Use the SDKs you already have. Share private files with signed links.',
  },
  {
    icon: Activity,
    title: 'Real-time analytics',
    body: 'Requests, bandwidth, hit ratio and countries as they happen.',
  },
];

// A gentle diurnal-looking curve for the live card.
const SERIES = [38, 42, 40, 47, 52, 49, 58, 63, 60, 68, 72, 66, 74, 81, 77, 85, 83, 90, 87, 94];

function sparkPath(values: number[], width: number, height: number) {
  const max = Math.max(...values);
  const min = Math.min(...values) - 10;
  const step = width / (values.length - 1);
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - ((v - min) / (max - min)) * height).toFixed(1)}`)
    .join(' ');
}

function LiveStatsCard() {
  const reduced = useReducedMotion();
  const [rps, setRps] = useState(1284);

  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => {
      setRps((value) => Math.max(1180, Math.min(1420, value + Math.round((Math.random() - 0.45) * 40))));
    }, 1600);
    return () => window.clearInterval(timer);
  }, [reduced]);

  const line = sparkPath(SERIES, 280, 44);

  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.06] p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] backdrop-blur-md">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-medium text-white/90">acme-shop.example</span>
        <span className="inline-flex items-center gap-1.5 text-white/70">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#4ade80] opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4ade80]" />
          </span>
          Live
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-[11px] text-white/60">Requests / s</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular-nums text-white">{rps.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-white/60">Cache hit ratio</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular-nums text-white">95.2%</dd>
        </div>
        <div>
          <dt className="text-[11px] text-white/60">Median latency</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular-nums text-white">18 ms</dd>
        </div>
      </dl>
      <svg viewBox="0 0 280 48" className="mt-3 h-12 w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="auth-spark-stroke" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#f7931e" />
            <stop offset="60%" stopColor="#e8336d" />
            <stop offset="100%" stopColor="#b98cf0" />
          </linearGradient>
          <linearGradient id="auth-spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#e8336d" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#e8336d" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L280,48 L0,48 Z`} fill="url(#auth-spark-fill)" />
        <path d={line} fill="none" stroke="url(#auth-spark-stroke)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3 text-[12px] text-white/75">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#4ade80]" aria-hidden />
        <span>
          Purged <code className="font-mono text-white/90">/products/*</code> on every edge in 0.4 s
        </span>
      </p>
    </div>
  );
}

/** The left half of the sign-in screens on wide viewports. */
export function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#150f1f] text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[45%] lg:max-w-[720px] lg:shrink-0">
      <BrandAtmosphere />
      <div className="relative flex w-full flex-col justify-between gap-8 overflow-y-auto px-12 py-10 xl:px-16">
        <AuthLogo />

        <div className="flex flex-col gap-7">
          <div>
            <p className="max-w-[460px] text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] xl:text-[38px]">
              Faster websites and files,{' '}
              <span className="bg-gradient-to-r from-[#ffb35c] via-[#ff6f9c] to-[#c9a2ff] bg-clip-text text-transparent">
                from one console.
              </span>
            </p>
            <p className="mt-3 max-w-[440px] text-[15px] leading-relaxed text-white/70">
              CDN, object storage and analytics for teams who would rather ship than babysit infrastructure.
            </p>
          </div>

          <ul className="flex flex-col gap-4">
            {PROOF_POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/[0.08]">
                  <Icon className="h-[18px] w-[18px] text-[#ffb35c]" aria-hidden />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-white/65">{body}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden max-w-[440px] [@media(min-height:860px)]:block">
            <LiveStatsCard />
          </div>
        </div>

        <figure className="max-w-[460px] border-t border-white/10 pt-6">
          <blockquote className="text-[14px] leading-relaxed text-white/85">
            “95% of our requests never reach our servers now, and when prices change we purge one path and it is live
            everywhere before the page reloads.”
          </blockquote>
          <figcaption className="mt-3 flex items-center gap-3">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white"
              aria-hidden
            >
              JD
            </span>
            <span className="text-[13px]">
              <span className="font-medium text-white">Jane Doe</span>
              <span className="text-white/60">, Head of engineering, Northwind Shop</span>
            </span>
          </figcaption>
        </figure>
      </div>
    </aside>
  );
}
