import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebsitesView } from './websites-view';
import { apiCalls, makeZone, mockApi, renderWithClient } from './test-utils';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

describe('WebsitesView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockReset();
  });

  it('lists websites and filters them by name or origin', async () => {
    mockApi([
      {
        url: '/api/zones',
        body: {
          zones: [
            makeZone({ id: 'z1', name: 'blog', originUrl: 'https://blog.example.com' }),
            makeZone({ id: 'z2', name: 'assets', originUrl: 'https://static.example.org' }),
          ],
          total: 2,
        },
      },
    ]);
    renderWithClient(<WebsitesView />);

    expect(await screen.findByRole('link', { name: 'blog' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'assets' })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: /search websites/i }), 'static');
    expect(screen.queryByRole('link', { name: 'blog' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'assets' })).toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox', { name: /search websites/i }));
    await userEvent.type(screen.getByRole('searchbox', { name: /search websites/i }), 'nothing-matches');
    expect(screen.getByText(/no websites match your search/i)).toBeInTheDocument();
  });

  it('shows an empty state that offers to add a website', async () => {
    mockApi([{ url: '/api/zones', body: { zones: [], total: 0 } }]);
    renderWithClient(<WebsitesView />);

    expect(await screen.findByText(/add your first website/i)).toBeInTheDocument();
    // One in the page header, one in the empty state.
    expect(await screen.findAllByRole('button', { name: /add a website/i })).toHaveLength(2);
  });

  it('creates a website and opens its overview', async () => {
    const fetchMock = mockApi([
      { url: '/api/zones', body: { zones: [], total: 0 } },
      { method: 'POST', url: '/api/zones', status: 201, body: makeZone({ id: 'new-zone' }) },
    ]);
    renderWithClient(<WebsitesView />);

    const [addButton] = await screen.findAllByRole('button', { name: /add a website/i });
    await userEvent.click(addButton);
    await userEvent.type(screen.getByLabelText('Name'), 'my-blog');
    await userEvent.type(screen.getByLabelText('Origin URL'), 'https://origin.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add website' }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/zones/new-zone'));
    const [, init] = apiCalls(fetchMock, 'POST')[0];
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'my-blog', originUrl: 'https://origin.example.com' });
  });

  it('does not offer to add a website to a viewer', async () => {
    mockApi([{ url: '/api/zones', body: { zones: [makeZone()], total: 1 } }], 'viewer');
    renderWithClient(<WebsitesView />);

    expect(await screen.findByRole('link', { name: 'my-zone' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a website/i })).not.toBeInTheDocument();
  });
});
