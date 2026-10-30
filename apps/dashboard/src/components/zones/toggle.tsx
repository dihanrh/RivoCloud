'use client';

/** @deprecated Moved to `@/components/ui/switch` (`<Switch checked onCheckedChange label />`). Shim for old imports. */
import { Switch } from '@/components/ui/switch';

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return <Switch checked={checked} onCheckedChange={onChange} label={label} disabled={disabled} />;
}
