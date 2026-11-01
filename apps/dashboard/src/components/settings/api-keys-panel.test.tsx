import '@/components/ui/test-polyfills';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { ApiKeysPanel } from './api-keys-panel';

const searchParams = { value: new URLSearchParams() };
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams.value }));

function renderPanel(role: string, meId = 'me-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ApiKeysPanel role={role} meId={meId} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu');
}

describe('ApiKeysPanel', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    searchParams.value = new URLSearchParams();
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
                { id: 'k0', name: 'deploy', keyPrefix: 'rivo_0000', permissions: ['zone:read'], userId: 'me-1', lastUsedAt: null, expiresAt: null },
                { id: 'k9', name: 'theirs', keyPrefix: 'rivo_9999', permissions: ['zone:read'], userId: 'other', lastUsedAt: null, expiresAt: null },
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

  it('shows the raw key once, in a success step, after creation', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('deploy');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'ci');
    await user.click(within(dialog).getByLabelText('zone:read'));
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));

    expect(await screen.findByDisplayValue('rivo_secret_value')).toBeInTheDocument();
    expect(screen.getByText('This key will not be shown again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy key' })).toBeInTheDocument();
    // The dialog title and the toast both say it.
    await waitFor(() => expect(screen.getAllByText('API key created')).toHaveLength(2));

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ name: 'ci', permissions: ['zone:read'] });

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByDisplayValue('rivo_secret_value')).not.toBeInTheDocument());

    // Reopening starts a fresh form: the secret is gone for good.
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByRole('dialog', { name: 'Create API key' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('rivo_secret_value')).not.toBeInTheDocument();
  });

  it('requires a name and at least one scope', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('deploy');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(within(dialog).getByText(/enter a name/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Pick at least one scope.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('opens the create dialog from ?create=1', async () => {
    searchParams.value = new URLSearchParams('create=1');
    renderPanel('developer');
    expect(await screen.findByRole('dialog', { name: 'Create API key' })).toBeInTheDocument();
  });

  it('developer can revoke only their own keys', async () => {
    const user = userEvent.setup();
    renderPanel('developer');
    await screen.findByText('theirs');

    let menu = await openRowMenu(user, 'deploy');
    expect(within(menu).getByRole('menuitem', { name: /revoke key/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    menu = await openRowMenu(user, 'theirs');
    expect(within(menu).queryByRole('menuitem', { name: /revoke key/i })).not.toBeInTheDocument();
  });

  it('owner and admin can revoke every key', async () => {
    const user = userEvent.setup();
    renderPanel('admin');
    await screen.findByText('theirs');
    const menu = await openRowMenu(user, 'theirs');
    expect(within(menu).getByRole('menuitem', { name: /revoke key/i })).toBeInTheDocument();
  });

  it('asks for confirmation before revoking, then toasts', async () => {
    const user = userEvent.setup();
    renderPanel('owner');
    await screen.findByText('deploy');
    const menu = await openRowMenu(user, 'deploy');
    await user.click(within(menu).getByRole('menuitem', { name: /revoke key/i }));
    const confirm = await screen.findByRole('alertdialog');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Revoke key' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/api-keys/k0' && init?.method === 'DELETE')).toBe(true),
    );
    expect(await screen.findByText('API key revoked')).toBeInTheDocument();
  });
});
