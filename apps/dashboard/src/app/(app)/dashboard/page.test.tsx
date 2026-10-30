import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccountHomePage from './page';

function stubBackend(zones: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path === '/api/me') return json({ id: 'u1', email: 'a@b.co', name: 'Ada', orgId: 'org-1', role: 'owner' });
      if (path === '/api/orgs') return json([{ id: 'org-1', name: 'Acme Inc' }]);
      if (path === '/api/zones') return json({ zones, total: zones.length });
      if (path === '/api/buckets') return json({ buckets: [{ id: 'b1' }, { id: 'b2' }], total: 2 });
      if (path.startsWith('/api/analytics/overview')) return json({ requests: 12345, bytesSent: 2048, hitRatio: 0.9 });
      if (path === '/api/orgs/org-1/members') return json([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
      return new Response('{}', { status: 404 });
    }),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccountHomePage />
    </QueryClientProvider>,
  );
}

const zone = (n: number) => ({ id: `zone-${n}-abcdefgh`, name: `site-${n}.com`, slug: `site-${n}`, enabled: n % 2 === 1 });

describe('AccountHomePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists the first five websites with links, and summarises traffic, storage and team', async () => {
    stubBackend([1, 2, 3, 4, 5, 6].map(zone));
    renderPage();

    expect(await screen.findByRole('link', { name: 'site-1.com' })).toHaveAttribute('href', '/zones/zone-1-abcdefgh');
    expect(screen.getByRole('link', { name: 'site-5.com' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'site-6.com' })).not.toBeInTheDocument();
    expect(screen.getByText('site-1-zone-1-a.cdn.rivocloud.dev')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/zones');

    expect(await screen.findByText('Acme Inc')).toBeInTheDocument();
    expect(await screen.findByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(await screen.findByText('buckets')).toBeInTheDocument();
    expect(await screen.findByText('members')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/settings/members');
  });

  it('invites the user to add a first website when there are none', async () => {
    stubBackend([]);
    renderPage();

    expect(await screen.findByText('No websites yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Add a website' })[0]).toHaveAttribute('href', '/zones');
  });
});
