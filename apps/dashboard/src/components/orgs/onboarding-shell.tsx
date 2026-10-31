'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Frame for the account pickers (/orgs, /orgs/new): slim brand bar with a way out,
 * then one centred card in the console's visual language.
 */
export function OnboardingShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2 rounded-md" aria-label="RivoCloud home">
            <Image src="/brand/rivocloud-mark.png" alt="" width={28} height={28} priority />
            <span className="text-[17px] font-semibold tracking-tight">RivoCloud</span>
          </Link>
          <Button variant="ghost" size="sm" leftIcon={<LogOut />} loading={loggingOut} onClick={() => void logout()}>
            Log out
          </Button>
        </div>
      </header>
      <div className="h-[2px]" style={{ background: 'var(--brand-gradient)' }} aria-hidden />
      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center sm:py-16">
        <Card className="w-full max-w-md overflow-hidden">
          <div className="px-6 pb-2 pt-6 sm:px-8 sm:pt-8">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-1.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          <div className="px-6 pb-6 pt-4 sm:px-8 sm:pb-8">{children}</div>
          {footer && <div className="border-t border-border bg-muted px-6 py-3.5 text-[13px] sm:px-8">{footer}</div>}
        </Card>
      </main>
    </div>
  );
}
