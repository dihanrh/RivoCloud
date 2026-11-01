'use client';

/**
 * DataTable shell — every list page uses this.
 *
 *   import { DataTable, TableToolbar, RowActionsMenu, TablePrimaryLink, type DataTableColumn }
 *     from '@/components/ui/data-table';
 *
 *   const columns: DataTableColumn<Zone>[] = [
 *     { id: 'name', header: 'Website', cell: (z) => <TablePrimaryLink href={`/zones/${z.id}`} sub={z.originUrl}>{z.name}</TablePrimaryLink> },
 *     { id: 'status', header: 'Status', cell: (z) => <StatusDot tone="success">Active</StatusDot>, hideBelow: 'sm' },
 *     { id: 'created', header: 'Created', cell: (z) => <RelativeTime value={z.createdAt} />, align: 'right' },
 *   ];
 *
 *   <DataTable
 *     aria-label="Websites"
 *     columns={columns}
 *     rows={filtered}                         // undefined while loading is fine
 *     getRowKey={(z) => z.id}
 *     loading={query.isLoading}
 *     error={query.error ? 'Could not load websites.' : null}
 *     onRetry={() => query.refetch()}
 *     empty={<EmptyState icon={Globe} title="No websites yet" action={<Button>Add a website</Button>} />}
 *     emptyFiltered={search ? <EmptyState title="No matching websites" /> : undefined}
 *     rowActions={(z) => (
 *       <RowActionsMenu label={`Actions for ${z.name}`}>
 *         <MenuItem icon={<ExternalLink />} onSelect={…}>Open</MenuItem>
 *         <MenuSeparator />
 *         <MenuItem icon={<Trash2 />} tone="destructive" onSelect={…}>Delete…</MenuItem>
 *       </RowActionsMenu>
 *     )}
 *     toolbar={
 *       <TableToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Search websites"
 *         count={filtered?.length} noun="website" actions={<Button leftIcon={<Plus />}>Add a website</Button>} />
 *     }
 *   />
 *
 * DataTableColumn<T>: id, header, cell(row), align ('left' | 'right'), className / headerClassName,
 *   width (CSS width for the <th>), hideBelow ('sm' | 'md' | 'lg' — hide the column on small screens).
 * DataTable props: columns, rows, getRowKey, loading, skeletonRows (5), error (node; shown with Retry
 *   when onRetry), empty (when rows is empty), emptyFiltered (shown instead when non-null and rows empty —
 *   pass it only while filters are active), rowActions(row) (trailing column, right-aligned),
 *   toolbar, footer, stickyHeader + maxHeight (scroll inside the card), onRowClick, aria-label, className.
 * TableToolbar props: search, onSearchChange, searchPlaceholder, filters (node: Selects),
 *   count + noun (renders "12 websites"), actions (right side), children (extra left-side content).
 */
import * as React from 'react';
import Link from 'next/link';
import { MoreHorizontal, RotateCw, Search, X } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Card } from './card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu';
import { Input } from './input';
import { TableSkeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  headerClassName?: string;
  width?: string;
  hideBelow?: 'sm' | 'md' | 'lg';
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined | null;
  getRowKey: (row: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  error?: React.ReactNode;
  onRetry?: () => void;
  empty?: React.ReactNode;
  emptyFiltered?: React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  stickyHeader?: boolean;
  maxHeight?: string;
  onRowClick?: (row: T) => void;
  'aria-label'?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading,
  skeletonRows = 5,
  error,
  onRetry,
  empty,
  emptyFiltered,
  rowActions,
  toolbar,
  footer,
  stickyHeader,
  maxHeight,
  onRowClick,
  'aria-label': ariaLabel,
  className,
}: DataTableProps<T>) {
  const colCount = columns.length + (rowActions ? 1 : 0);
  const list = rows ?? [];
  const showEmpty = !loading && !error && list.length === 0;

  let body: React.ReactNode;
  if (loading) {
    const cellClassNames: (string | undefined)[] = columns.map((col) => (col.hideBelow ? HIDE[col.hideBelow] : undefined));
    if (rowActions) cellClassNames.push('w-12');
    body = <TableSkeleton rows={skeletonRows} columns={colCount} cellClassNames={cellClassNames} bare />;
  } else if (error) {
    body = (
      <tr>
        <td colSpan={colCount} className="px-4 py-10">
          <div role="alert" className="flex flex-col items-center gap-3 text-center text-[13px] text-destructive">
            <span>{error}</span>
            {onRetry && (
              <Button variant="secondary" size="sm" leftIcon={<RotateCw />} onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        </td>
      </tr>
    );
  } else {
    body = list.map((row) => (
      <TableRow
        key={getRowKey(row)}
        className={cn('group', onRowClick && 'cursor-pointer')}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
      >
        {columns.map((col) => (
          <TableCell key={col.id} className={cn(col.align === 'right' && 'text-right', col.hideBelow && HIDE[col.hideBelow], col.className)}>
            {col.cell(row)}
          </TableCell>
        ))}
        {rowActions && (
          <TableCell className="w-12 py-1.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
            {rowActions(row)}
          </TableCell>
        )}
      </TableRow>
    ));
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      {toolbar}
      {showEmpty ? (
        <div className={cn(toolbar ? 'border-t border-border' : undefined)}>{emptyFiltered ?? empty}</div>
      ) : (
        <Table
          aria-label={ariaLabel}
          aria-busy={loading || undefined}
          stickyHeader={stickyHeader}
          containerClassName={cn(toolbar && 'border-t border-border', maxHeight && 'overflow-y-auto')}
          containerStyle={maxHeight ? { maxHeight } : undefined}
        >
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(col.align === 'right' && 'text-right', col.hideBelow && HIDE[col.hideBelow], col.headerClassName)}
                >
                  {col.header}
                </TableHead>
              ))}
              {rowActions && (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>{body}</TableBody>
        </Table>
      )}
      {footer && <div className="border-t border-border bg-muted px-4 py-2.5 text-[13px] text-muted-foreground">{footer}</div>}
    </Card>
  );
}

export function TableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search',
  filters,
  count,
  noun,
  actions,
  children,
  className,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  count?: number;
  noun?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 p-3 sm:flex-row sm:items-center', className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {onSearchChange && (
          <Input
            type="search"
            aria-label={searchPlaceholder}
            placeholder={searchPlaceholder}
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && search) {
                e.stopPropagation();
                onSearchChange('');
              }
            }}
            leftIcon={<Search />}
            rightAddon={
              search ? (
                <button type="button" onClick={() => onSearchChange('')} aria-label="Clear search" className="-mx-1 rounded p-0.5 hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : undefined
            }
            className="w-full sm:w-72"
            inputClassName="h-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
        )}
        {filters}
        {children}
        {count !== undefined && noun && (
          <span className="text-[13px] text-muted-foreground" aria-live="polite">
            {formatNumber(count)} {count === 1 ? noun : `${noun}s`}
          </span>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The kebab "more actions" button + menu for a table row. Children are MenuItems. */
export function RowActionsMenu({ label, children, align = 'end' }: { label: string; children: React.ReactNode; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} className="text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The primary-column link: bold name (links to the detail page) with an optional muted second line. */
export function TablePrimaryLink({ href, children, sub, className }: { href: string; children: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <Link href={href} className="truncate font-semibold text-foreground hover:text-primary hover:underline">
        {children}
      </Link>
      {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}
