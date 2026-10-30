import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** The gradient cloud mark plus the RivoCloud wordmark, for the top bar. */
export function BrandLockup({ href = '/dashboard', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2 rounded-sm', className)} aria-label="RivoCloud home">
      <Image src="/brand/rivocloud-mark.png" alt="" width={30} height={30} priority />
      <span className="text-[17px] font-semibold tracking-tight text-foreground">RivoCloud</span>
    </Link>
  );
}

/** The full stacked logo (mark + wordmark), for sign-in and onboarding screens. */
export function BrandLogo({ width = 168, className }: { width?: number; className?: string }) {
  return (
    <Image
      src="/brand/rivocloud-logo.png"
      alt="RivoCloud"
      width={width}
      height={Math.round((width * 320) / 480)}
      priority
      className={className}
    />
  );
}
