import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MembersPanel } from './members-panel';
import type { OrgMember } from '@/lib/types';

const members: OrgMember[] = [
  { userId: 'u1', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z', user: { id: 'u1', email: 'owner@example.com', name: 'Olive Owner' } },
  { userId: 'u2', role: 'developer', joinedAt: '2026-01-02T00:00:00.000Z', user: { id: 'u2', email: 'dev@example.com', name: 'Dev Dana' } },
];

function renderPanel(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MembersPanel orgId="org-1" role={role} />
    </QueryClientProvider>,
  );
}

describe('MembersPanel', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({}), { status: 201 })
        : new Response(JSON.stringify(members), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('viewer sees no invite form', async () => {
    renderPanel('viewer');
    expect(await screen.findByText('dev@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('owner invites a member', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('dev@example.com');

    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.selectOptions(screen.getByLabelText('Role'), 'viewer');
    await user.click(screen.getByRole('button', { name: /invite/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(post![0]).toBe('/api/orgs/org-1/members');
      expect(JSON.parse(post![1].body)).toEqual({ email: 'new@example.com', role: 'viewer' });
    });
  });

  it("admin's role options exclude admin", async () => {
    renderPanel('admin');
    await screen.findByText('dev@example.com');

    const options = within(screen.getByLabelText('Role')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['developer', 'viewer']);
  });

  it('owner gets role selects and remove buttons on non-owner rows only', async () => {
    renderPanel('owner');
    await screen.findByText('dev@example.com');

    expect(screen.getAllByRole('button', { name: /^remove/i })).toHaveLength(1);
    expect(screen.getByLabelText('Role for dev@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Role for owner@example.com')).not.toBeInTheDocument();
  });
});
