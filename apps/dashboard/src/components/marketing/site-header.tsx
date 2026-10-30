'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { BrandLockup } from '@/components/brand/brand';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const NAV_LINKS = [
  { href: '#products', label: 'Products' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#use-cases', label: 'Use cases' },
  { href: '#developers', label: 'Developers' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * The marketing top bar. It is the only place on the page that links to
 * sign-in and registration.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 1024) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const solid = scrolled || open;

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full transition-[background-color,border-color,box-shadow] duration-200',
        solid
          ? 'border-b border-border/80 bg-white/80 shadow-[0_1px_0_rgba(29,32,37,0.02),0_8px_24px_-12px_rgba(29,32,37,0.12)] backdrop-blur-md supports-[backdrop-filter]:bg-white/70'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-[72px] w-full max-w-[1200px] items-center gap-4 lg:gap-8 px-4 sm:px-6 lg:px-8">
        <BrandLockup href="/" size="lg" className="shrink-0" />
        <nav aria-label="Primary" className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-0.5">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="rounded-md px-3 py-2 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="hidden h-9 px-3.5 text-sm sm:inline-flex">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm" className="h-9 px-3.5 text-sm">
            <Link href="/register">Sign up</Link>
          </Button>
          <button
            type="button"
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
      <nav
        id="mobile-nav"
        aria-label="Primary mobile"
        hidden={!open}
        className="border-t border-border bg-white/95 backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto grid max-w-[1200px] gap-1 px-4 py-3 sm:px-6">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2.5 text-[15px] font-medium text-foreground hover:bg-muted"
              >
                {link.label}
              </a>
            </li>
          ))}
          <li className="mt-2 border-t border-border pt-3 sm:hidden">
            <Button asChild variant="outline" className="h-10 w-full text-[15px]">
              <Link href="/login">Log in</Link>
            </Button>
          </li>
        </ul>
      </nav>
    </header>
  );
}
