'use client';

import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * Row kebab menu for zone tables. Same look as `RowActionsMenu`, plus
 * `openOverlay(fn)` for items that open a dialog or sheet. The overlay opens
 * only once the menu has finished closing (from its close-auto-focus step),
 * and the menu does not hand focus back to the kebab. Opening it any earlier
 * lets the closing menu take focus away from the overlay (the type-to-confirm
 * field loses focus in browsers; the two focus traps loop forever in jsdom).
 *
 *   <ZoneRowMenu label="Actions for blog">
 *     {(openOverlay) => <MenuItem onSelect={() => openOverlay(() => setDeleting(true))}>Delete…</MenuItem>}
 *   </ZoneRowMenu>
 */
export function ZoneRowMenu({
  label,
  children,
}: {
  label: string;
  children: (openOverlay: (open: () => void) => void) => React.ReactNode;
}) {
  const pendingOverlay = React.useRef<(() => void) | null>(null);
  const openOverlay = React.useCallback((open: () => void) => {
    pendingOverlay.current = open;
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const open = pendingOverlay.current;
          if (!open) return;
          pendingOverlay.current = null;
          event.preventDefault();
          open();
        }}
      >
        {children(openOverlay)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
