import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiKeysPanel } from './api-keys-panel';

function renderPanel(role: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApiKeysPanel role={role} />
    </QueryClientProvider>,
  );
}

describe('ApiKeysPanel', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(
            JSON.stringify({ id: 'k1', name: 'ci', keyPrefix: 'rivo_abcd', permissions: ['zone:read'], rawKey: 'rivo_secret_value' }),
            { status: 201 },
          )
        : init?.method === 'DELETE'
          ? new Response(JSON.stringify({ success: true }), { status: 200 })
          : new Response(
              JSON.stringify([
                { id: 'k0', name: 'deploy', keyPrefix: 'rivo_0000', permissions: ['zone:read'], lastUsedAt: null, expiresAt: null },
              ]),
              { status: 200 },
            ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('developer cannot pick billing:read', async () => {
    const user = userEvent.setup();
    renderPanel('developer');
    await screen.findByText('deploy');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByLabelText('zone:read')).toBeInTheDocument();
    expect(screen.queryByLabelText('billing:read')).not.toBeInTheDocument();
  });

  it('shows the raw key once after creation', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('deploy');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    await user.type(await screen.findByLabelText('Name'), 'ci');
    await user.click(screen.getByLabelText('zone:read'));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByDisplayValue('rivo_secret_value')).toBeInTheDocument();
    expect(screen.getByText('This key will not be shown again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ name: 'ci', permissions: ['zone:read'] });

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue('rivo_secret_value')).not.toBeInTheDocument();
  });

  it('asks for confirmation before revoking', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('deploy');
    await user.click(screen.getByRole('button', { name: 'Revoke deploy' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/api-keys/k0' && init?.method === 'DELETE')).toBe(true);
  });
});
