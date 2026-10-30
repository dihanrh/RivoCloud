'use client';

/**
 * DropdownMenu (Radix) — row "more actions" kebabs and header menus.
 * Keyboard: Enter/Space/ArrowDown opens, arrows move (wrapping), Home/End jump, type-ahead,
 * Escape closes and returns focus to the trigger. Opens with a quick fade/slide.
 *
 *   import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, MenuItem,
 *            MenuLabel, MenuSeparator } from '@/components/ui/dropdown-menu';
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild>
 *       <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}><MoreHorizontal /></Button>
 *     </DropdownMenuTrigger>
 *     <DropdownMenuContent align="end">
 *       <MenuItem icon={<ExternalLink />} onSelect={() => router.push(href)}>Open</MenuItem>
 *       <MenuItem icon={<Copy />} onSelect={() => copy(row.id)}>Copy ID</MenuItem>
 *       <MenuSeparator />
 *       <MenuItem icon={<Trash2 />} tone="destructive" onSelect={() => setDeleting(row)}>Delete…</MenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 *
 * MenuItem props: icon, tone ('default' | 'destructive'), shortcut (right-aligned hint),
 *   trailing (right-aligned node, e.g. a check), description (second line), onSelect, disabled,
 *   asChild (wrap a <Link> for navigation items).
 * Content props: align ('start' | 'center' | 'end'), side, sideOffset (default 6), className.
 * `RowActionsMenu` in data-table.tsx wraps the kebab trigger for table rows.
 */
import * as React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export const DropdownMenuContent = React.forwardRef<HTMLDivElement, Menu.DropdownMenuContentProps>(function DropdownMenuContent(
  { className, sideOffset = 6, align = 'start', collisionPadding = 8, loop = true, ...props },
  ref,
) {
  return (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        loop={loop}
        className={cn(
          'rc-menu z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-48 origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-[0_10px_30px_rgba(29,32,37,0.14)] focus:outline-none',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
});

export interface MenuItemProps extends Omit<Menu.DropdownMenuItemProps, 'children'> {
  icon?: React.ReactNode;
  tone?: 'default' | 'destructive';
  shortcut?: string;
  trailing?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}

const itemClass =
  'relative flex min-h-8 w-full cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

export const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
  { className, icon, tone = 'default', shortcut, trailing, description, children, asChild, ...props },
  ref,
) {
  const destructive = tone === 'destructive';
  const classes = cn(
    itemClass,
    destructive && 'text-destructive data-[highlighted]:bg-destructive-soft data-[highlighted]:text-destructive',
    className,
  );
  if (asChild) {
    // The child (e.g. <Link>) receives the item behaviour; icon/trailing are not injected.
    return <Menu.Item ref={ref} asChild className={classes} {...props}>{children}</Menu.Item>;
  }
  return (
    <Menu.Item ref={ref} className={classes} {...props}>
      {icon && (
        <span className={cn('flex shrink-0', destructive ? 'text-destructive' : 'text-muted-foreground')} aria-hidden>
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {description && <span className="truncate text-xs text-muted-foreground">{description}</span>}
      </span>
      {shortcut && <kbd className="ml-auto pl-3 font-sans text-xs tracking-wide text-muted-foreground">{shortcut}</kbd>}
      {trailing && <span className="ml-auto flex shrink-0 pl-2">{trailing}</span>}
    </Menu.Item>
  );
});

export function MenuLabel({ className, ...props }: Menu.DropdownMenuLabelProps) {
  return <Menu.Label className={cn('px-2.5 pb-1 pt-1.5 text-xs font-semibold text-muted-foreground', className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: Menu.DropdownMenuSeparatorProps) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

// Aliases matching the Radix naming, for people who reach for those first.
export const DropdownMenuItem = MenuItem;
export const DropdownMenuLabel = MenuLabel;
export const DropdownMenuSeparator = MenuSeparator;
