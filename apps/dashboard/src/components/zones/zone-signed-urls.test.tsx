import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ZoneSignedUrls } from './zone-signed-urls';
import type { Zone } from '@/lib/types';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const zone: Zone = {
  id: 'zone-1',
  orgId: 'org-1',
  projectId: null,
  name: 'private',
  slug: 'private',
  originUrl: 'https://origin.example.com',
  originProtocol: 'https',
  cacheTtl: 3600,
  browserTtl: 0,
  enabled: true,
  signedUrlsRequired: false,
  hasSigningSecret: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ZoneSignedUrls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('turns signed URLs on through the zone PATCH endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...zone, signedUrlsRequired: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<ZoneSignedUrls zone={zone} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /require signed urls/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/zones/zone-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ signedUrlsRequired: true }) }),
    );
  });

  it('hides the rotate button until the zone has a secret', () => {
    renderWithProviders(<ZoneSignedUrls zone={zone} />);
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('rotates the secret only after the user confirms', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...zone, hasSigningSecret: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    renderWithProviders(<ZoneSignedUrls zone={{ ...zone, signedUrlsRequired: true, hasSigningSecret: true }} />);
    const rotate = screen.getByRole('button', { name: /rotate signing secret/i });

    await userEvent.click(rotate);
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(rotate);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/zones/zone-1/signing-secret/rotate', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText(/previously shared links no longer work/i)).toBeInTheDocument();
  });
});
