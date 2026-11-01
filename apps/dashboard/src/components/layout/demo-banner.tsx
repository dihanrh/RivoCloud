import { FlaskConical } from 'lucide-react';

/** A quiet notice at the top of the console on demo deployments (NEXT_PUBLIC_DEMO_MODE=true). */
export function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return null;
  return (
    <div
      role="note"
      className="mb-5 flex items-center gap-2 rounded-lg border border-dashed border-border-strong bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-foreground">Demo environment</span> — sample data, and changes reset periodically.
      </span>
    </div>
  );
}
