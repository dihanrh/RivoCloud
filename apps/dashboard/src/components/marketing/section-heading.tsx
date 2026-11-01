import { cn } from '@/lib/utils';

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8', className)}>{children}</div>;
}

export function SectionHeading({
  id,
  kicker,
  title,
  lede,
  align = 'left',
  tone = 'light',
  className,
}: {
  id?: string;
  kicker?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: 'left' | 'center';
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {kicker && (
        <p className={cn('text-sm font-semibold', tone === 'dark' ? 'text-[#ff8fb5]' : 'text-primary')}>{kicker}</p>
      )}
      <h2
        id={id}
        className={cn(
          'mt-2 text-[28px] font-semibold leading-[1.15] tracking-tight text-balance sm:text-[40px]',
          tone === 'dark' ? 'text-white' : 'text-foreground',
        )}
      >
        {title}
      </h2>
      {lede && (
        <p
          className={cn(
            'mt-4 text-base leading-relaxed text-pretty sm:text-lg',
            tone === 'dark' ? 'text-[#b7bcc6]' : 'text-muted-foreground',
          )}
        >
          {lede}
        </p>
      )}
    </div>
  );
}
