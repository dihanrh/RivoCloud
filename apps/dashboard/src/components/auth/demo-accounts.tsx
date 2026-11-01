'use client';

import { FlaskConical } from 'lucide-react';

export const DEMO_PASSWORD = 'DemoPass123!';

export const DEMO_ACCOUNTS = [
  { email: 'owner@demo.rivo', role: 'Owner' },
  { email: 'admin@demo.rivo', role: 'Admin' },
  { email: 'dev@demo.rivo', role: 'Developer' },
  { email: 'viewer@demo.rivo', role: 'Viewer' },
] as const;

/** Read at render so tests can stub it; Next inlines NEXT_PUBLIC_* at build time. */
export function isDemoMode() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

/**
 * Quick-fill list of the seeded demo users. Only rendered when
 * NEXT_PUBLIC_DEMO_MODE=true. Clicking fills the form; it never submits.
 */
export function DemoAccounts({ onPick }: { onPick: (email: string, password: string) => void }) {
  if (!isDemoMode()) return null;
  return (
    <section aria-labelledby="demo-accounts-title" className="rounded-xl border border-dashed border-border-strong bg-muted/60 p-3.5">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <h2 id="demo-accounts-title" className="text-[12.5px] font-semibold text-foreground">
          Demo accounts
        </h2>
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          Password <code className="font-mono text-foreground">{DEMO_PASSWORD}</code>
        </span>
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-1.5">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.email}>
            <button
              type="button"
              onClick={() => onPick(account.email, DEMO_PASSWORD)}
              aria-label={`Use the ${account.role.toLowerCase()} demo account (${account.email})`}
              className="flex w-full flex-col items-start rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary-soft/50"
            >
              <span className="text-[12.5px] font-medium text-foreground">{account.role}</span>
              <span className="w-full truncate font-mono text-[11px] text-muted-foreground">{account.email}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
