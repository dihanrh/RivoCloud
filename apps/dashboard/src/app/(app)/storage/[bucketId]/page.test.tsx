import '@/components/ui/test-polyfills';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import BucketDetailPage from './page';

const object = (id: string, key: string) => ({
  id,
  bucketId: 'b1',
  key,
  versionId: 'v1',
  isLatest: true,
  size: '2048',
  contentType: 'image/png',
  etag: null,
  storagePath: 'x',
  metadata: null,
  status: 'ready',
  expiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

function stubBackend(role: string) {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === '/api/me') return json({ id: 'u1', email: 'a@b.co', name: 'Ada', orgId: 'org-1', role });
    if (path === '/api/buckets/b1') {
      return json({ id: 'b1', orgId: 'org-1', projectId: null, name: 'photos', region: 'eu-central', versioningEnabled: false, public: false, lifecycleRules: null, createdAt: '2026-01-01T00:00:00.000Z' });
    }
    if (path === '/api/buckets/b1/objects') return json({ objects: [object('o1', 'cat.png')], total: 1 });
    if (path === '/api/buckets/b1/objects/cat.png' && init?.method === 'DELETE') return json({ success: true });
    if (path === '/api/zones') return json({ zones: [], total: 0 });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const params = Promise.resolve({ bucketId: 'b1' });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Suspense fallback={null}>
            <BucketDetailPage params={params} />
          </Suspense>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
}

describe('BucketDetailPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deletes a file through a confirm dialog (never window.confirm) and toasts', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const fetchMock = stubBackend('owner');
    await renderPage();

    expect(await screen.findByRole('heading', { name: 'photos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload file/i })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Actions for cat.png' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete file/i }));
    const confirm = await screen.findByRole('alertdialog');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Delete file' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([p, init]) => p === '/api/buckets/b1/objects/cat.png' && init?.method === 'DELETE')).toBe(true));
    expect(await screen.findByText('File deleted')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('hides upload and delete for a viewer and shows a read-only note', async () => {
    const user = userEvent.setup();
    stubBackend('viewer');
    await renderPage();
    expect(await screen.findByText(/your role can view and share files/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload file/i })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Actions for cat.png' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /share link/i })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /delete file/i })).not.toBeInTheDocument();
  });
});
