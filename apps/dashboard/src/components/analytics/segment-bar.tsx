import { formatNumber, formatPercent } from '@/lib/format';

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * A part-to-whole bar: segments sized by share, separated by a 2px surface gap, rounded ends.
 * Segments under 0.5% still get a sliver so they stay visible; the list beside it carries the
 * exact numbers, and each segment's title shows them on hover.
 */
export function SegmentBar({ segments, label, className = 'h-2.5' }: { segments: Segment[]; label: string; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div role="img" aria-label={label} className={`flex w-full gap-[2px] overflow-hidden rounded-full ${className}`}>
      {visible.map((s) => {
        const share = total ? s.value / total : 0;
        return (
          <div
            key={s.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ background: s.color, flexGrow: Math.max(share, 0.005), flexBasis: 0 }}
            title={`${s.label}: ${formatNumber(s.value)} (${formatPercent(share)})`}
          />
        );
      })}
    </div>
  );
}
