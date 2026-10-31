import '@/components/ui/test-polyfills';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebsitesView } from './websites-view';
import { apiCalls, makeZone, mockApi, renderWithClient } from './test-utils';

const push = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/zones',
  useSearchParams: () => search,
}));

const twoZones = {
  zones: [
    makeZone({ id: 'z1aaaaaa', name: 'blog', slug: 'blog', originUrl: 'https://blog.example.com' }),
    makeZone({ id: 'z2bbbbbb', name: 'assets', slug: 'assets', originUrl: 'https://static.example.org', enabled: false, signedUrlsRequired: true }),
  ],
  total: 2,
};

describe('WebsitesView', () => {
  beforeEach(() => {
    search = new URLSearchParams();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockReset();
  });

  it('renders rows with hostname, origin, status, and signed URL badge', async () => {
    mockApi([{ url: '/api/zones', body: twoZones }]);
    renderWithClient(<WebsitesView />);

    expect(await screen.findByRole('link', { name: 'blog' })).toHaveAttribute('href', '/zones/z1aaaaaa');
    expect(screen.getByText('blog-z1aaaaaa.cdn.rivocloud.dev')).toBeInTheDocument();
    expect(screen.getByText('https://static.example.org')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Websites' });
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(within(table).getByText('Paused')).toBeInTheDocument();
    expect(within(table).getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('2 websites')).toBeInTheDocument();
  });

  it('filters by search text and by status', async () => {
    mockApi([{ url: '/api/zones', body: twoZones }]);
    renderWithClient(<WebsitesView />);
    await screen.findByRole('link', { name: 'blog' });

    const box = screen.getByRole('searchbox', { name: /search websites/i });
    await userEvent.type(box, 'static');
    expect(screen.queryByRole('link', { name: 'blog' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'assets' })).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /filter by status/i }), 'active');
    expect(screen.getByRole('link', { name: 'blog' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'assets' })).not.toBeInTheDocument();

    await userEvent.type(box, 'nothing-matches');
    expect(screen.getByText(/no websites match your filters/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('link', { name: 'assets' })).toBeInTheDocument();
  });

  it('shows an empty state that offers to add a website', async () => {
    mockApi([{ url: '/api/zones', body: { zones: [], total: 0 } }]);
    renderWithClient(<WebsitesView />);

    expect(await screen.findByText(/add your first website/i)).toBeInTheDocument();
    expect(await screen.findAllByRole('button', { name: /add a website/i })).not.toHaveLength(0);
  });

  it('creates a website, toasts, and opens its overview', async () => {
    const fetchMock = mockApi([
      { url: '/api/zones', body: { zones: [], total: 0 } },
      { method: 'POST', url: '/api/zones', status: 201, body: makeZone({ id: 'new-zone', name: 'my-blog' }) },
    ]);
    renderWithClient(<WebsitesView />);

    const [addButton] = await screen.findAllByRole('button', { name: /add a website/i });
    await userEvent.click(addButton);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add website' }));
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(within(dialog).getByLabelText('Name'), 'my-blog');
    await userEvent.type(within(dialog).getByLabelText('Origin URL'), 'ftp://nope');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add website' }));
    expect(within(dialog).getByText(/full http\(s\) url/i)).toBeInTheDocument();
    expect(apiCalls(fetchMock, 'POST')).toHaveLength(0);

    await userEvent.clear(within(dialog).getByLabelText('Origin URL'));
    await userEvent.type(within(dialog).getByLabelText('Origin URL'), 'https://origin.example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add website' }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/zones/new-zone'));
    expect(await screen.findByText('Website added')).toBeInTheDocument();
    const [, init] = apiCalls(fetchMock, 'POST')[0];
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'my-blog', originUrl: 'https://origin.example.com' });
  }, 20_000);

  it('opens the add dialog when the URL carries ?create=1', async () => {
    search = new URLSearchParams('create=1');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    mockApi([{ url: '/api/zones', body: twoZones }]);
    renderWithClient(<WebsitesView />);

    expect(await screen.findByRole('dialog', { name: 'Add a website' })).toBeInTheDocument();
    expect(replaceState).toHaveBeenCalled();
    expect(String(replaceState.mock.calls.at(-1)?.[2])).not.toContain('create=1');
    replaceState.mockRestore();
  });

  it('deletes a website from the row menu only after its name is typed, then toasts', async () => {
    const fetchMock = mockApi([
      { url: '/api/zones', body: twoZones },
      { method: 'DELETE', url: '/api/zones/z1aaaaaa', body: { success: true } },
    ]);
    renderWithClient(<WebsitesView />);

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for blog' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete website/i }));

    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete website' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'blo');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'g');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(await screen.findByText('Website deleted')).toBeInTheDocument();
    expect(apiCalls(fetchMock, 'DELETE').map(([url]) => url)).toEqual(['/api/zones/z1aaaaaa']);
  });

  it('pauses a website from the row menu with a toast', async () => {
    const fetchMock = mockApi([
      { url: '/api/zones', body: twoZones },
      { method: 'PATCH', url: '/api/zones/z1aaaaaa', body: { ...twoZones.zones[0], enabled: false } },
    ]);
    renderWithClient(<WebsitesView />);

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for blog' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pause website' }));

    expect(await screen.findByText('Website paused')).toBeInTheDocument();
    expect(JSON.parse(String(apiCalls(fetchMock, 'PATCH')[0][1]?.body))).toEqual({ enabled: false });
  });

  it('gives a viewer no add, pause, or delete actions', async () => {
    mockApi([{ url: '/api/zones', body: twoZones }], 'viewer');
    renderWithClient(<WebsitesView />);

    expect(await screen.findByRole('link', { name: 'blog' })).toBeInTheDocument();
    expect(await screen.findByText('View only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a website/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Actions for blog' }));
    expect(await screen.findByRole('menuitem', { name: 'Copy hostname' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /pause|delete/i })).not.toBeInTheDocument();
  });
});
