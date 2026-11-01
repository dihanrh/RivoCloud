'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { authInputClass } from './form-field';

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { id: string };

/**
 * A password field with a show/hide toggle and a Caps Lock warning that only
 * shows while the field has focus.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { id, className, onKeyDown, onKeyUp, onFocus, onBlur, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [focused, setFocused] = useState(false);
  const capsId = `${id}-caps`;
  const showCaps = capsLock && focused;

  function readCaps(event: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof event.getModifierState === 'function') setCapsLock(event.getModifierState('CapsLock'));
  }

  const ids = [describedBy, showCaps ? capsId : undefined].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Input
          ref={ref}
          id={id}
          type={visible ? 'text' : 'password'}
          spellCheck={false}
          autoCapitalize="none"
          className={cn(authInputClass, 'pr-11', className)}
          aria-describedby={ids || undefined}
          onKeyDown={(event) => {
            readCaps(event);
            onKeyDown?.(event);
          }}
          onKeyUp={(event) => {
            readCaps(event);
            onKeyUp?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />
        <button
          type="button"
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={id}
          title={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[var(--radius)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-offset-[-2px]"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {showCaps && (
        <p id={capsId} role="status" className="flex items-center gap-1.5 text-[12.5px] text-warning">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Caps Lock is on
        </p>
      )}
    </div>
  );
});
