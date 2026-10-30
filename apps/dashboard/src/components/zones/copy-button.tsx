'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
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

  return (
    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={copy} aria-label={copied ? 'Copied' : label} title={label}>
      {copied ? <Check className="text-success" /> : <Copy className="text-muted-foreground" />}
    </Button>
  );
}
