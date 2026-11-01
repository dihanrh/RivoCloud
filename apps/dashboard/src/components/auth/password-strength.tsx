'use client';

import { Check, Circle } from 'lucide-react';
import { PASSWORD_MIN_LENGTH } from '@/lib/validation';
import { cn } from '@/lib/utils';

export type StrengthLabel = 'Weak' | 'Fair' | 'Good' | 'Strong';

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
  checks: { id: string; label: string; met: boolean }[];
}

/** Score a password on four checks: the backend minimum length, mixed case, a number, a symbol. */
export function scorePassword(password: string): PasswordStrength {
  const checks = [
    { id: 'length', label: `${PASSWORD_MIN_LENGTH}+ characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'case', label: 'Upper and lower case', met: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    { id: 'number', label: 'A number', met: /\d/.test(password) },
    { id: 'symbol', label: 'A symbol', met: /[^A-Za-z0-9]/.test(password) },
  ];
  let score = checks.filter((c) => c.met).length as PasswordStrength['score'];
  // Shorter than the minimum is always weak, whatever else it contains.
  if (!checks[0].met) score = Math.min(score, 1) as PasswordStrength['score'];
  const label: StrengthLabel = score <= 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong';
  return { score, label, checks };
}

const TONE: Record<StrengthLabel, { bar: string; text: string }> = {
  Weak: { bar: 'bg-destructive', text: 'text-destructive' },
  Fair: { bar: 'bg-brand-orange', text: 'text-warning' },
  Good: { bar: 'bg-[#3a9a57]', text: 'text-success' },
  Strong: { bar: 'bg-success', text: 'text-success' },
};

/** A four-segment meter with a text label and a requirement checklist. */
export function PasswordStrengthMeter({ password, id }: { password: string; id?: string }) {
  if (!password) {
    return (
      <p id={id} className="text-[12.5px] text-muted-foreground">
        Use {PASSWORD_MIN_LENGTH} or more characters with a mix of letters, numbers and symbols.
      </p>
    );
  }
  const strength = scorePassword(password);
  const tone = TONE[strength.label];
  const filled = Math.max(strength.score, 1);
  return (
    <div id={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((segment) => (
            <span
              key={segment}
              className={cn('h-1 rounded-full transition-colors duration-200', segment <= filled ? tone.bar : 'bg-border')}
            />
          ))}
        </div>
        <p className="shrink-0 text-[12px]" aria-live="polite" data-testid="password-strength">
          <span className="text-muted-foreground">Password strength: </span>
          <span className={cn('font-semibold', tone.text)}>{strength.label}</span>
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {strength.checks.map((check) => (
          <li key={check.id} className={cn('flex items-center gap-1.5', check.met ? 'text-success' : 'text-muted-foreground')}>
            {check.met ? (
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <Circle className="mx-px h-3 w-3 shrink-0" aria-hidden />
            )}
            <span>
              {check.label}
              <span className="sr-only">{check.met ? ' (met)' : ' (not met)'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
