import '@/components/ui/test-polyfills';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import StoragePage from './page';

const searchParams = { value: new URLSearchParams() };
const push = vi.fn();
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams.value, useRouter: () => ({ push, replace: vi.fn() }) }));

const bucket = (id: string, name: string) => ({
  id,
  orgId: 'org-1',
  projectId: null,
  name,
  region: 'us-east-1',
  versioningEnabled: false,
  public: false,
  lifecycleRules: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

function stubBackend(role = 'owner', deleteStatus = 200) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === '/api/me') return json({ id: 'u1', email: 'a@b.co', name: 'Ada', orgId: 'org-1', role });
    if (path === '/api/buckets' && init?.method === 'POST') return json(bucket('b9', 'new-bucket'), 201);
    if (path === '/api/buckets') return json({ buckets: [bucket('b1', 'photos'), bucket('b2', 'backups')], total: 2 });
    if (path === '/api/buckets/b1' && init?.method === 'DELETE') {
      return deleteStatus === 200 ? json({ success: true }) : json({ message: 'Bucket is not empty — delete its objects first' }, deleteStatus);
    }
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <StoragePage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('StoragePage', () => {
  beforeEach(() => {
    searchParams.value = new URLSearchParams();
    push.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens the Create bucket dialog from ?create=1', async () => {
    searchParams.value = new URLSearchParams('create=1');
    stubBackend();
    renderPage();
    expect(await screen.findByRole('dialog', { name: 'Create bucket' })).toBeInTheDocument();
  });

  it('does not open the dialog from ?create=1 for a viewer, and hides write actions', async () => {
    searchParams.value = new URLSearchParams('create=1');
    stubBackend('viewer');
    renderPage();
    expect(await screen.findByText(/your role can view buckets/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create bucket' })).not.toBeInTheDocument();
  });

  it('creates a bucket, toasts and opens it', async () => {
    const user = userEvent.setup();
    const fetchMock = stubBackend();
    renderPage();
    await screen.findByRole('link', { name: 'photos' });
    await user.click(screen.getAllByRole('button', { name: 'Create bucket' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'new-bucket');
    await user.click(within(dialog).getByRole('button', { name: 'Create bucket' }));

    expect(await screen.findByText('Bucket created')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ name: 'new-bucket', public: false });
    expect(push).toHaveBeenCalledWith('/storage/b9');
  });

  it('deletes a bucket only after typing its name, then toasts', async () => {
    const user = userEvent.setup();
    const fetchMock = stubBackend();
    renderPage();
    await screen.findByRole('link', { name: 'photos' });

    await user.click(screen.getByRole('button', { name: 'Actions for photos' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete bucket/i }));
    const confirm = await screen.findByRole('alertdialog');
    const confirmButton = within(confirm).getByRole('button', { name: 'Delete bucket' });
    expect(confirmButton).toBeDisabled();

    await user.type(within(confirm).getByLabelText(/to confirm/i), 'photo');
    expect(confirmButton).toBeDisabled();
    await user.type(within(confirm).getByLabelText(/to confirm/i), 's');
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() => expect(fetchMock.mock.calls.some(([p, init]) => p === '/api/buckets/b1' && init?.method === 'DELETE')).toBe(true));
    expect(await screen.findByText('Bucket deleted')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open with the server error when the bucket is not empty', async () => {
    const user = userEvent.setup();
    stubBackend('owner', 409);
    renderPage();
    await screen.findByRole('link', { name: 'photos' });
    await user.click(screen.getByRole('button', { name: 'Actions for photos' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete bucket/i }));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByLabelText(/to confirm/i), 'photos');
    await user.click(within(confirm).getByRole('button', { name: 'Delete bucket' }));
    expect(await within(confirm).findByText(/bucket is not empty/i)).toBeInTheDocument();
  });
});
