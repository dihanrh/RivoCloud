/**
 * Low-level table elements. For lists prefer `DataTable` (data-table.tsx), which composes
 * these with a toolbar, sticky header, row actions and loading/empty/error states.
 *
 *   import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
 *
 * Table props: every <table> prop plus `containerClassName` (the horizontal-scroll wrapper)
 *   `containerStyle`, and `stickyHeader` (header sticks while the wrapper scrolls; give the wrapper a max height).
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({
  className,
  containerClassName,
  containerStyle,
  stickyHeader,
  ...props
}: React.HTMLAttributes<HTMLTableElement> & { containerClassName?: string; containerStyle?: React.CSSProperties; stickyHeader?: boolean }) {
  return (
    // `relative` makes the scroll wrapper the containing block for absolutely positioned
    // descendants (e.g. `sr-only` header labels), so they cannot widen the page on mobile.
    <div className={cn('relative w-full overflow-x-auto', containerClassName)} style={containerStyle}>
      <table
        className={cn('w-full caption-bottom text-[13px]', stickyHeader && '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[1] [&_thead_th]:bg-muted', className)}
        {...props}
      />
    </div>
  );
}
export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-muted [&_tr]:border-b [&_tr]:hover:bg-muted', className)} {...props} />;
}
export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-border transition-colors hover:bg-muted/60', className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('h-9 whitespace-nowrap px-4 text-left align-middle text-xs font-semibold text-muted-foreground', className)}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-2.5 align-middle', className)} {...props} />;
}
