import '@/components/ui/test-polyfills';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ShellProvider } from './shell-context';
import { Sidebar } from './sidebar';

let pathname = '/zones';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}));
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ data: { role: 'owner', orgId: 'o1', name: 'O', email: 'o@x' } }) }));
vi.mock('@/hooks/use-orgs', () => ({ useOrgs: () => ({ data: [] }) }));
vi.mock('@/hooks/use-select-org', () => ({ useSelectOrg: () => ({ isPending: false, mutateAsync: vi.fn() }) }));
vi.mock('@/hooks/use-zone', () => ({ useZone: (id: string) => ({ data: { id, name: 'acme.com', enabled: true } }) }));
vi.mock('@/hooks/use-zones', () => ({
  useZones: () => ({
    data: {
      zones: [
        { id: 'z1', name: 'acme.com', originUrl: 'https://o.acme.com', enabled: true },
        { id: 'z2', name: 'shop.acme.com', originUrl: 'https://o.shop.acme.com', enabled: true },
      ],
    },
  }),
}));

function renderSidebar() {
  return render(
    <ShellProvider>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </ShellProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    pathname = '/zones';
  });

  it('collapses to an icon rail and remembers it across reloads', async () => {
    const { unmount } = renderSidebar();
    const aside = screen.getByRole('complementary', { name: 'Primary' });
    expect(aside).not.toHaveAttribute('data-collapsed');
    expect(screen.getByRole('link', { name: 'Websites' })).toHaveAttribute('aria-current', 'page');

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(window.localStorage.getItem('rc.sidebar.collapsed')).toBe('1');
    // Labels are gone visually but links keep their accessible names.
    expect(screen.getByRole('link', { name: 'Storage' })).toBeInTheDocument();

    unmount();
    renderSidebar();
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Primary' })).toHaveAttribute('data-collapsed', 'true'));
    await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(window.localStorage.getItem('rc.sidebar.collapsed')).toBe('0');
  });

  it('shows a website switcher in zone context that keeps the current section', async () => {
    pathname = '/zones/z1/caching';
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Caching' })).toHaveAttribute('aria-current', 'page');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Website: acme.com/ }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('shop.acme.com')]));
  });
});
