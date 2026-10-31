import { Eye } from 'lucide-react';

/** The subtle note shown on pages whose actions are all hidden for the viewer's role. */
export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2 rounded-[var(--radius)] border border-border bg-muted px-3 py-2 text-[13px] text-muted-foreground">
      <Eye className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}
