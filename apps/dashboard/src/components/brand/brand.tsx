import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const LOCKUP_SIZES = {
  // Console top bar.
  md: { mark: 30, text: 'text-[17px]', gap: 'gap-2' },
  // Marketing site header.
  lg: { mark: 44, text: 'text-[22px] sm:text-2xl', gap: 'gap-2.5' },
} as const;

/** The gradient cloud mark plus the RivoCloud wordmark, for the top bar. */
export function BrandLockup({
  href = '/dashboard',
  size = 'md',
  className,
}: {
  href?: string;
  size?: keyof typeof LOCKUP_SIZES;
  className?: string;
}) {
  const s = LOCKUP_SIZES[size];
  return (
    <Link href={href} className={cn('flex items-center rounded-sm', s.gap, className)} aria-label="RivoCloud home">
      <Image src="/brand/rivocloud-mark.png" alt="" width={s.mark} height={s.mark} priority />
      <span className={cn('font-semibold tracking-tight text-foreground', s.text)}>RivoCloud</span>
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
