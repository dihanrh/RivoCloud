import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AuthLogo, BrandAtmosphere, BrandPanel } from './brand-panel';

const FOOTER_LINKS = [
  { label: 'Terms', href: '#' },
  { label: 'Privacy', href: '#' },
  { label: 'Status', href: '#' },
];

/**
 * Sign-in layout. At 1024px and up: a dark brand panel on the left (~45%) and
 * the form on white, vertically centred. Below that the brand panel collapses
 * into a slim header that carries the logo.
 */
export function AuthLayout({
  title,
  description,
  children,
  aside,
  icon,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Secondary line under the form, e.g. "New to RivoCloud? Create an account". */
  aside?: React.ReactNode;
  /** An optional status icon shown above the title (success, expired link). */
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      <BrandPanel />

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {/* Narrow screens: the slim brand header. */}
        <header className="relative overflow-hidden bg-[#150f1f] lg:hidden">
          <BrandAtmosphere compact />
          <div className="relative flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
            <AuthLogo size="sm" />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-white/85 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to home
            </Link>
          </div>
          <div className="relative h-[2px]" style={{ background: 'var(--brand-gradient)' }} aria-hidden />
        </header>

        {/* Wide screens: just the way back. */}
        <div className="hidden px-10 pt-8 lg:block">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to home
          </Link>
        </div>

        <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:py-8">
          <div className="w-full max-w-[400px]">
            {icon && <div className="mb-5">{icon}</div>}
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.015em] text-foreground">{title}</h1>
            {description && <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{description}</p>}
            <div className="mt-7 flex flex-col gap-5">{children}</div>
            {aside && <div className="mt-7 text-[13.5px] text-muted-foreground">{aside}</div>}
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 pb-6 pt-2 text-[12.5px] text-muted-foreground lg:justify-start lg:px-10">
          <span>© 2026 RivoCloud</span>
          <nav aria-label="Legal" className="flex gap-x-5">
            {FOOTER_LINKS.map((link) => (
              <a key={link.label} href={link.href} className="rounded-sm hover:text-foreground hover:underline">
                {link.label}
              </a>
            ))}
          </nav>
        </footer>
      </div>
    </div>
  );
}

/** A round icon chip used above the title on state screens. */
export function StateIcon({ tone, children }: { tone: 'success' | 'warning' | 'brand'; children: React.ReactNode }) {
  const tones = {
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    brand: 'bg-primary-soft text-primary',
  }[tone];
  return <span className={`flex h-12 w-12 items-center justify-center rounded-full ${tones} [&_svg]:h-6 [&_svg]:w-6`}>{children}</span>;
}
