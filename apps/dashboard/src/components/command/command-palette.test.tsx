import '@/components/ui/test-polyfills';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useGlobalShortcuts } from '@/components/layout/keyboard-shortcuts';
import { ShellProvider, useShell } from '@/components/layout/shell-context';
import { CommandPalette } from './command-palette';
import { buildCommandItems, filterCommandItems } from './command-items';
import type { Bucket, Zone } from '@/lib/types';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/dashboard',
}));

const zones = [
  { id: 'z1', name: 'acme.com', slug: 'acme', originUrl: 'https://origin.acme.com', enabled: true },
  { id: 'z2', name: 'shop.acme.com', slug: 'shop', originUrl: 'https://shop-origin.acme.com', enabled: true },
  { id: 'z3', name: 'blog.example.org', slug: 'blog', originUrl: 'https://blog.example.org', enabled: false },
] as Zone[];
const buckets = [{ id: 'b1', name: 'media-assets', region: 'eu-west' }] as Bucket[];

vi.mock('@/hooks/use-zones', () => ({ useZones: () => ({ data: { zones, total: 3 }, isLoading: false }) }));
vi.mock('@/hooks/use-buckets', () => ({ useBuckets: () => ({ data: { buckets, total: 1 }, isLoading: false }) }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ data: { id: 'u1', name: 'Olive Owner', email: 'o@x', role: 'owner', orgId: 'o1' } }) }));

function OpenButton() {
  const { openPalette } = useShell();
  return <button onClick={openPalette}>open</button>;
}

function renderPalette() {
  return render(
    <ShellProvider>
      <OpenButton />
      <CommandPalette />
    </ShellProvider>,
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
  });

  it('filters pages and live websites as you type', async () => {
    renderPalette();
    const user = userEvent.setup();
    await user.click(screen.getByText('open'));
    const input = await screen.findByRole('combobox', { name: 'Search or jump to' });
    await user.type(input, 'acme');
    const options = screen.getAllByRole('option');
    const labels = options.map((o) => o.textContent);
    expect(labels.some((l) => l?.includes('acme.com'))).toBe(true);
    expect(labels.some((l) => l?.includes('shop.acme.com'))).toBe(true);
    expect(labels.some((l) => l?.includes('blog.example.org'))).toBe(false);

    await user.clear(input);
    await user.type(input, 'api');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('API keys')]));
  });

  it('navigates to the highlighted result with Enter and closes', async () => {
    renderPalette();
    const user = userEvent.setup();
    await user.click(screen.getByText('open'));
    const input = await screen.findByRole('combobox');
    await user.type(input, 'acme');
    // First option is highlighted; move to the second and open it.
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    const second = screen.getAllByRole('option')[1];
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', second.id);
    await user.keyboard('{Enter}');
    expect(push).toHaveBeenCalledWith('/zones/z2');
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });

  it('opens with Ctrl+K and shows recently opened items first', async () => {
    window.localStorage.setItem('rc.command.recent', JSON.stringify(['bucket:b1']));
    function Hotkeys() {
      useGlobalShortcuts();
      return null;
    }
    render(
      <ShellProvider>
        <Hotkeys />
        <CommandPalette />
      </ShellProvider>,
    );
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('combobox')).toHaveFocus();
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('media-assets');
  });

  it('offers quick actions that route to create dialogs', async () => {
    renderPalette();
    const user = userEvent.setup();
    await user.click(screen.getByText('open'));
    await user.type(await screen.findByRole('combobox'), 'create bucket');
    await user.keyboard('{Enter}');
    expect(push).toHaveBeenCalledWith('/storage?create=1');
  });
});

describe('command items', () => {
  it('hides write actions and the audit log from viewers', () => {
    const items = buildCommandItems({ role: 'viewer', zones, buckets });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('Add a website');
    expect(labels).not.toContain('Invite member');
    expect(labels).not.toContain('Audit log');
    expect(labels).toContain('Websites');
  });

  it('requires every query word to match', () => {
    const items = buildCommandItems({ role: 'owner', zones, buckets, zone: { id: 'z1', name: 'acme.com' } });
    const result = filterCommandItems(items, 'acme cach');
    expect(result[0]).toMatchObject({ group: 'This website', label: 'Caching' });
  });
});
