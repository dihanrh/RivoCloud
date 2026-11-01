import { cn } from '@/lib/utils';

const TONES = [
  'bg-primary-soft text-primary',
  'bg-[#efe8f7] text-[#5b2a8c]',
  'bg-[#fff1e0] text-[#a34f00]',
  'bg-success-soft text-success',
  'bg-[#e6effc] text-[#1f5fc4]',
];

export function initialsFor(name: string | null | undefined, email?: string | null): string {
  const source = (name && name.trim()) || email || '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?').slice(0, 2);
}

/** Round initials avatar with a stable tone per person. */
export function UserAvatar({ name, email, className }: { name?: string | null; email?: string | null; className?: string }) {
  const seed = email || name || '';
  const hash = Array.from(seed).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
        seed ? TONES[hash % TONES.length] : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {initialsFor(name, email)}
    </span>
  );
}
