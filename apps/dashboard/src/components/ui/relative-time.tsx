'use client';

/**
 * RelativeTime — "3 min ago" with the absolute date/time in a tooltip and <time dateTime>.
 *
 *   import { RelativeTime } from '@/components/ui/relative-time';
 *   <RelativeTime value={log.createdAt} />
 *
 * Re-renders every minute so the text stays fresh. Falsy/invalid values render "—".
 */
import * as React from 'react';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { Tooltip } from './tooltip';

export function RelativeTime({ value, className }: { value: Date | string | number | null | undefined; className?: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const d = value === null || value === undefined ? null : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return <span className={className}>—</span>;
  return (
    <Tooltip content={formatDateTime(d)}>
      <time dateTime={d.toISOString()} className={className} tabIndex={0} suppressHydrationWarning>
        {formatRelativeTime(d, now)}
      </time>
    </Tooltip>
  );
}
