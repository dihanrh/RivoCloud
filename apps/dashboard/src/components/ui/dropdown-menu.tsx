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
 *       <MenuItem icon={<Trash2 />} tone="destructive" onSelectAfterClose={() => setDeleting(row)}>Delete…</MenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 *
 * MenuItem props: icon, tone ('default' | 'destructive'), shortcut (right-aligned hint),
 *   trailing (right-aligned node, e.g. a check), description (second line), onSelect, disabled,
 *   asChild (wrap a <Link> for navigation items), onSelectAfterClose (see below).
 *
 * Items that open a Dialog/ConfirmDialog/Sheet MUST use `onSelectAfterClose` instead of `onSelect`.
 * It runs only once the menu has fully closed (after its exit animation, from the content's
 * close-auto-focus step), and the menu then does NOT hand focus back to its trigger. Opening an
 * overlay any earlier lets the closing menu steal focus from it (in browsers the type-to-confirm
 * field stops receiving keystrokes; in jsdom the two focus traps loop forever).
 * Content props: align ('start' | 'center' | 'end'), side, sideOffset (default 6), className.
 * `RowActionsMenu` in data-table.tsx wraps the kebab trigger for table rows.
 */
import * as React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

/** Holds the action an item queued with `onSelectAfterClose`, run once the menu has closed. */
const PendingOverlayContext = React.createContext<React.MutableRefObject<(() => void) | null> | null>(null);

export function DropdownMenu(props: Menu.DropdownMenuProps) {
  const pending = React.useRef<(() => void) | null>(null);
  return (
    <PendingOverlayContext.Provider value={pending}>
      <Menu.Root {...props} />
    </PendingOverlayContext.Provider>
  );
}

export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export const DropdownMenuContent = React.forwardRef<HTMLDivElement, Menu.DropdownMenuContentProps>(function DropdownMenuContent(
  { className, sideOffset = 6, align = 'start', collisionPadding = 8, loop = true, onCloseAutoFocus, ...props },
  ref,
) {
  const pending = React.useContext(PendingOverlayContext);
  return (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        loop={loop}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const run = pending?.current;
          if (!run) return;
          pending.current = null;
          // Keep focus off the trigger: the overlay about to open owns focus now.
          event.preventDefault();
          run();
        }}
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
  /** For items that open an overlay: runs after the menu has fully closed, without refocusing the trigger. */
  onSelectAfterClose?: () => void;
}

const itemClass =
  'relative flex min-h-8 w-full cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

export const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
  { className, icon, tone = 'default', shortcut, trailing, description, children, asChild, onSelect, onSelectAfterClose, ...props },
  ref,
) {
  const pending = React.useContext(PendingOverlayContext);
  const handleSelect = (event: Event) => {
    onSelect?.(event);
    if (!onSelectAfterClose || event.defaultPrevented) return;
    if (pending) pending.current = onSelectAfterClose;
    else window.setTimeout(onSelectAfterClose, 0);
  };
  const itemProps = { ...props, onSelect: onSelect || onSelectAfterClose ? handleSelect : undefined };
  const destructive = tone === 'destructive';
  const classes = cn(
    itemClass,
    destructive && 'text-destructive data-[highlighted]:bg-destructive-soft data-[highlighted]:text-destructive',
    className,
  );
  if (asChild) {
    // The child (e.g. <Link>) receives the item behaviour; icon/trailing are not injected.
    return <Menu.Item ref={ref} asChild className={classes} {...itemProps}>{children}</Menu.Item>;
  }
  return (
    <Menu.Item ref={ref} className={classes} {...itemProps}>
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
