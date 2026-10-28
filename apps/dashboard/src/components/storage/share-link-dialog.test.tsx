import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareLinkDialog } from './share-link-dialog';
import type { Zone } from '@/lib/types';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeZone(overrides: Partial<Zone>): Zone {
  return {
    id: 'zone-1',
    orgId: 'org-1',
    projectId: null,
    name: 'zone',
    slug: 'zone',
    originUrl: 'https://origin.example.com',
    originProtocol: 'https',
    cacheTtl: 3600,
    browserTtl: 0,
    enabled: true,
    signedUrlsRequired: false,
    hasSigningSecret: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function stubBackend(zones: Zone[]) {
  const fetchMock = vi.fn(async (path: string) => {
    if (path === '/api/zones') {
      return new Response(JSON.stringify({ zones, total: zones.length }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ url: 'https://private.cdn.test/report.pdf?expires=1&sig=abc&download=1', expiresAt: '2026-09-26T12:00:00.000Z' }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ShareLinkDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only offers zones that require signed URLs, and signs with the chosen options', async () => {
    const fetchMock = stubBackend([
      makeZone({ id: 'zone-public', name: 'Public site' }),
      makeZone({ id: 'zone-private', name: 'Private files', signedUrlsRequired: true, hasSigningSecret: true }),
    ]);

    renderWithProviders(<ShareLinkDialog bucketId="bucket-1" objectKey="report.pdf" onOpenChange={vi.fn()} />);

    const zoneSelect = await screen.findByLabelText(/zone/i);
    expect(await screen.findByRole('option', { name: 'Private files' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Public site' })).not.toBeInTheDocument();
    expect(zoneSelect).toHaveValue('zone-private');

    await userEvent.selectOptions(screen.getByLabelText(/expires after/i), '3600');
    await userEvent.click(screen.getByRole('checkbox', { name: /force download/i }));
    await userEvent.click(screen.getByRole('button', { name: /create link/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/buckets/bucket-1/objects/report.pdf/sign',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ zoneId: 'zone-private', expiresIn: 3600, download: true }) }),
    );
    expect(await screen.findByDisplayValue('https://private.cdn.test/report.pdf?expires=1&sig=abc&download=1')).toBeInTheDocument();
  });

  it('explains what to do when no zone requires signed URLs', async () => {
    stubBackend([makeZone({ name: 'Public site' })]);
    renderWithProviders(<ShareLinkDialog bucketId="bucket-1" objectKey="report.pdf" onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/no zone requires signed urls yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create link/i })).not.toBeInTheDocument();
  });

  it('renders nothing while no object is selected', () => {
    stubBackend([]);
    renderWithProviders(<ShareLinkDialog bucketId="bucket-1" objectKey={null} onOpenChange={vi.fn()} />);
    expect(screen.queryByText(/share link/i)).not.toBeInTheDocument();
  });
});
