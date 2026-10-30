import Link from 'next/link';
import { BrandLockup } from '@/components/brand/brand';
import { Button } from '@/components/ui/button';

const CAPABILITIES = [
  {
    title: 'Websites and CDN caching',
    body: 'Put your site behind a global edge network. Set cache lifetimes per website and purge cached files when you publish.',
  },
  {
    title: 'Object storage with signed links',
    body: 'Store files in buckets and share private files with time-limited signed links.',
  },
  {
    title: 'Traffic analytics',
    body: 'See requests, bandwidth, cache hit ratio, latency and where your visitors are, for one website or all of them.',
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-8">
        <BrandLockup href="/" />
        <nav className="flex items-center gap-2" aria-label="Account">
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">Sign up</Link>
          </Button>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-16 sm:px-8 sm:py-24">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Speed up your website and store your files in one place.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted-foreground">
          RivoCloud is a CDN, object storage and analytics platform with a single console. Add a website, cache it at the edge,
          keep your files in buckets, and watch the traffic.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/register">Create an account</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Log in</Link>
          </Button>
        </div>
        <ul className="mt-16 divide-y divide-border border-y border-border">
          {CAPABILITIES.map((item) => (
            <li key={item.title} className="grid gap-1 py-5 sm:grid-cols-[16rem_1fr] sm:gap-8">
              <h2 className="text-base font-semibold">{item.title}</h2>
              <p className="text-[13px] text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>
      </main>
      <footer className="border-t border-border px-4 py-5 text-[13px] text-muted-foreground sm:px-8">
        RivoCloud. CDN, object storage and analytics.
      </footer>
    </div>
  );
}
