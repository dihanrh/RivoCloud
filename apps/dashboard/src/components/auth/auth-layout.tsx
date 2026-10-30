import { BrandLogo } from '@/components/brand/brand';

/**
 * Split sign-in layout: a brand panel on the left (on top for narrow screens)
 * and a white form card on the right.
 */
export function AuthLayout({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section
        className="flex flex-col items-center justify-center gap-6 px-6 py-10 text-center text-white lg:py-0"
        style={{ background: 'var(--brand-gradient)' }}
      >
        <div className="rounded-2xl bg-white px-8 py-6 shadow-sm">
          <BrandLogo width={200} />
        </div>
        <p className="max-w-xs text-lg font-medium leading-snug">CDN, object storage and analytics in one console.</p>
      </section>
      <section className="flex items-center justify-center bg-canvas px-4 py-10">
        <div className="w-full max-w-sm rounded-[var(--radius)] border border-border bg-background p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
          <div className="mt-6 flex flex-col gap-5">{children}</div>
        </div>
      </section>
    </main>
  );
}
