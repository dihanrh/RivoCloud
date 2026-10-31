import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsIndexPage from './page';
import MembersPage from './members/page';
import ApiKeysPage from './api-keys/page';
import AuditLogPage from './audit-log/page';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to), useSearchParams: () => null }));

function stubBackend(role: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path === '/api/me') return json({ id: 'u1', email: 'me@example.com', name: 'Me', orgId: 'org-1', role });
      if (path === '/api/orgs/org-1/members') {
        return json([{ userId: 'u1', role, joinedAt: null, user: { name: 'Me', email: 'me@example.com' } }]);
      }
      if (path === '/api/api-keys') return json([]);
      if (path.startsWith('/api/orgs/org-1/audit-logs')) return json({ items: [], nextCursor: null });
      return new Response('{}', { status: 404 });
    }),
  );
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('settings routes', () => {
  beforeEach(() => redirect.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('/settings redirects to /settings/members', () => {
    SettingsIndexPage();
    expect(redirect).toHaveBeenCalledWith('/settings/members');
  });

  it('members page shows its header and the members panel', async () => {
    stubBackend('owner');
    renderPage(<MembersPage />);
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByText('Manage account')).toBeInTheDocument();
    expect(await screen.findByText('me@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeInTheDocument();
  });

  it('api keys page shows its header and the keys panel', async () => {
    stubBackend('developer');
    renderPage(<ApiKeysPage />);
    expect(screen.getByRole('heading', { name: 'API keys' })).toBeInTheDocument();
    expect(await screen.findByText('No API keys yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create key' })).toBeInTheDocument();
  });

  it('audit log page shows the log to admins', async () => {
    stubBackend('admin');
    renderPage(<AuditLogPage />);
    expect(await screen.findByText('No audit events yet')).toBeInTheDocument();
  });

  it('audit log page explains that only owners and admins can view it', async () => {
    stubBackend('developer');
    renderPage(<AuditLogPage />);
    expect(await screen.findByText(/only account owners and admins can view the audit log/i)).toBeInTheDocument();
    expect(screen.queryByText('No audit events yet')).not.toBeInTheDocument();
  });
});
