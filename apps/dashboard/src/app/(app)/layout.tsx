import { cookies } from 'next/headers';
import { AppShell } from '@/components/layout/app-shell';
import { SIDEBAR_COOKIE } from '@/components/layout/shell-constants';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Seed the sidebar width from the cookie so a collapsed rail doesn't flash open on load.
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === 'collapsed';
  return (
    <ToastProvider>
      <TooltipProvider>
        <AppShell initialCollapsed={collapsed}>{children}</AppShell>
      </TooltipProvider>
    </ToastProvider>
  );
}
