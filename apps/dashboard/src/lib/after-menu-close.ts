/**
 * Run `fn` once the open DropdownMenu has finished closing. Use it for menu items that open a
 * Dialog/ConfirmDialog: opening the dialog in the same tick makes the menu's focus return and the
 * dialog's focus trap fight over focus (an endless focus loop in jsdom, a flicker in browsers).
 *
 *   <MenuItem onSelect={() => afterMenuClose(() => setDeleting(row))}>Delete…</MenuItem>
 */
export function afterMenuClose(fn: () => void): void {
  window.setTimeout(fn, 0);
}
