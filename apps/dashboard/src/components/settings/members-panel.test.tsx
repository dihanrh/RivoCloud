import '@/components/ui/test-polyfills';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { MembersPanel } from './members-panel';
import type { OrgMember } from '@/lib/types';

const searchParams = { value: new URLSearchParams() };
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams.value }));

const members: OrgMember[] = [
  { userId: 'u1', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z', user: { id: 'u1', email: 'owner@example.com', name: 'Olive Owner' } },
  { userId: 'u2', role: 'developer', joinedAt: '2026-01-02T00:00:00.000Z', user: { id: 'u2', email: 'dev@example.com', name: 'Dev Dana' } },
];

function renderPanel(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MembersPanel orgId="org-1" role={role} meId="u1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('MembersPanel', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    searchParams.value = new URLSearchParams();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' || init?.method === 'DELETE' || init?.method === 'PATCH'
        ? new Response(JSON.stringify({}), { status: 200 })
        : new Response(JSON.stringify(members), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('viewer sees no invite, role or remove controls, and a read-only note', async () => {
    const user = userEvent.setup();
    renderPanel('viewer');
    expect(await screen.findByText('dev@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Role for dev@example.com')).not.toBeInTheDocument();
    expect(screen.getByText(/only account owners and admins can invite/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for dev@example.com' }));
    expect(await screen.findByRole('menuitem', { name: 'Copy email' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('owner invites a member from the dialog and gets a toast', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('dev@example.com');

    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Email'), 'new@example.com');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'viewer');
    await user.click(within(dialog).getByRole('button', { name: 'Invite member' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(post![0]).toBe('/api/orgs/org-1/members');
      expect(JSON.parse(post![1].body)).toEqual({ email: 'new@example.com', role: 'viewer' });
    });
    expect(await screen.findByText('Member invited')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('validates the email inline before inviting', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('dev@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Invite member' }));
    expect(await within(dialog).findByText('Enter an email address.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('opens the invite dialog from ?invite=1', async () => {
    searchParams.value = new URLSearchParams('invite=1');
    renderPanel('admin');
    expect(await screen.findByRole('dialog', { name: 'Invite member' })).toBeInTheDocument();
  });

  it("admin's role options exclude admin", async () => {
    const user = userEvent.setup();
    renderPanel('admin');
    await screen.findByText('dev@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite member' }));

    const options = within(await screen.findByLabelText('Role')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Developer', 'Viewer']);
  });

  it('owner gets role selects and remove actions on non-owner rows only', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('dev@example.com');

    expect(screen.getByLabelText('Role for dev@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Role for owner@example.com')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for owner@example.com' }));
    expect(await screen.findByRole('menuitem', { name: 'Copy email' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /remove member/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Actions for dev@example.com' }));
    expect(await screen.findByRole('menuitem', { name: /remove member/i })).toBeInTheDocument();
  });

  it('removes a member only after confirming, then toasts', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('dev@example.com');

    await user.click(screen.getByRole('button', { name: 'Actions for dev@example.com' }));
    await user.click(await screen.findByRole('menuitem', { name: /remove member/i }));

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('dev@example.com')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    await user.click(within(confirm).getByRole('button', { name: 'Remove member' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/orgs/org-1/members/u2' && init?.method === 'DELETE')).toBe(true),
    );
    expect(await screen.findByText('Member removed')).toBeInTheDocument();
  });

  it('changing a role saves it and toasts', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('dev@example.com');
    await user.selectOptions(screen.getByLabelText('Role for dev@example.com'), 'admin');
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch?.[0]).toBe('/api/orgs/org-1/members/u2');
      expect(JSON.parse(patch![1].body)).toEqual({ role: 'admin' });
    });
    expect(await screen.findByText('Role updated')).toBeInTheDocument();
  });
});
