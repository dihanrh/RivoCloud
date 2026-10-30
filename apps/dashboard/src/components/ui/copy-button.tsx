'use client';

/**
 * CopyButton — copies a value to the clipboard; the icon morphs into a green check
 * for 1.5 s. No toast (the morph is the feedback).
 *
 *   import { CopyButton } from '@/components/ui/copy-button';
 *   <CopyButton value={zone.hostname} label="Copy hostname" />            // 24px icon button
 *   <CopyButton value={key} label="Copy key" size="icon" />               // 32px icon button
 *   <CopyButton value={url} label="Copy link" variant="secondary" showLabel />   // icon + text
 *
 * Props: value (string to copy), label (accessible name + tooltip, default "Copy"),
 *   size ('xs' 24px default | 'icon-sm' 28px | 'icon' 32px | 'sm' with showLabel),
 *   variant (any Button variant, default 'ghost'), showLabel (render the label text), className.
 */
import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, type ButtonProps } from './button';
import { Tooltip } from './tooltip';

export interface CopyButtonProps {
  value: string;
  label?: string;
  size?: 'xs' | 'icon-sm' | 'icon' | 'sm';
  variant?: ButtonProps['variant'];
  showLabel?: boolean;
  className?: string;
}

export function CopyButton({ value, label = 'Copy', size = 'xs', variant = 'ghost', showLabel = false, className }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the value stays selectable on screen.
    }
  }

  const icon = (
    <span className="relative inline-flex h-4 w-4 items-center justify-center" aria-hidden>
      <Copy
        className={cn(
          'absolute transition-all duration-150',
          variant === 'ghost' && 'text-muted-foreground',
          copied ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
        )}
      />
      <Check className={cn('absolute text-success transition-all duration-150', copied ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} />
    </span>
  );

  if (showLabel) {
    return (
      <Button type="button" variant={variant} size={size === 'xs' ? 'sm' : size === 'sm' ? 'sm' : 'default'} onClick={copy} className={className}>
        {icon}
        <span aria-live="polite">{copied ? 'Copied' : label}</span>
      </Button>
    );
  }

  return (
    <Tooltip content={copied ? 'Copied' : label}>
      <Button
        type="button"
        variant={variant}
        size={size === 'xs' || size === 'sm' ? 'icon-sm' : size}
        className={cn(size === 'xs' && 'h-6 w-6', className)}
        onClick={copy}
        aria-label={copied ? 'Copied' : label}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}
