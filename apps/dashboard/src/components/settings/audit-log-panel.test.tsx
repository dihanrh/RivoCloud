import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditLogPanel } from './audit-log-panel';
import type { AuditLogEntry } from '@/lib/types';

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'log-1',
    action: 'zone.created',
    resourceType: 'zone',
    resourceId: 'zone-9',
    ipAddress: '203.0.113.9',
    userAgent: null,
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    user: { id: 'u1', email: 'owner@example.com', name: 'Olive' },
    apiKey: null,
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditLogPanel orgId="org-1" />
    </QueryClientProvider>,
  );
}

describe('AuditLogPanel', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders actor, action, and resource', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            entry(),
            entry({ id: 'log-2', action: 'zone.deleted', user: null, apiKey: { id: 'k1', name: 'ci', keyPrefix: 'rivo_abcd' } }),
            entry({ id: 'log-4', action: 'zone.updated', apiKey: { id: 'k2', name: 'deploy', keyPrefix: 'rc_live' } }),
            entry({ id: 'log-3', action: 'cron.cleanup', user: null, resourceType: null, resourceId: null, ipAddress: null }),
          ],
          nextCursor: null,
        }),
        { status: 200 },
      ),
    );
    renderPanel();

    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByText('zone.created')).toBeInTheDocument();
    expect(screen.getAllByText('zone zone-9')).toHaveLength(3);
    expect(screen.getByText('API key rivo_abcd…')).toBeInTheDocument();
    // API-key actions also carry the key's creator as `user`; the key is the actor.
    expect(screen.getByText('API key rc_live… (by owner@example.com)')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getAllByText('203.0.113.9')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('load more requests the next cursor', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [entry()], nextCursor: 'log-1' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [entry({ id: 'log-0', action: 'zone.updated' })], nextCursor: null }), { status: 200 }),
      );
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('zone.updated')).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![0]).toContain('cursor=log-1');
  });
});
