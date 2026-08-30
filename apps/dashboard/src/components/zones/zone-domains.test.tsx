import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ZoneDomains } from './zone-domains';
import type { ZoneDomain } from '@/lib/types';

function makeDomain(overrides: Partial<ZoneDomain> = {}): ZoneDomain {
  return {
    id: 'domain-1',
    zoneId: 'zone-1',
    domain: 'cdn.example.com',
    sslStatus: 'pending_dns',
    sslError: null,
    certExpiresAt: null,
    isPrimary: false,
    verifiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    cnameTarget: 'edge.rivocloud.dev',
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ZoneDomains', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders an empty state and the CNAME instructions when there are no domains', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    expect(await screen.findByText(/no custom domains yet/i)).toBeInTheDocument();
  });

  it('renders a domain row with its status badge', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([makeDomain({ sslStatus: 'active' })]), { status: 200 }));
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    expect(await screen.findByText('cdn.example.com')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows the sslError when a domain is in the error state', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([makeDomain({ sslStatus: 'error', sslError: 'DNS did not resolve' })]), { status: 200 }),
    );
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    expect(await screen.findByText('DNS did not resolve')).toBeInTheDocument();
  });

  it('submits a new domain and shows the CNAME instructions returned by the API', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeDomain()), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([makeDomain()]), { status: 200 }));

    renderWithClient(<ZoneDomains zoneId="zone-1" />);
    await screen.findByText(/no custom domains yet/i);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/domain/i), 'cdn.example.com');
    await user.click(screen.getByRole('button', { name: /add domain/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/zones/zone-1/domains',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('calls verify when the Verify button is clicked', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([makeDomain()]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeDomain({ sslStatus: 'pending_ssl' })), { status: 201 }));

    renderWithClient(<ZoneDomains zoneId="zone-1" />);
    const verifyButton = await screen.findByRole('button', { name: /verify/i });

    const user = userEvent.setup();
    await user.click(verifyButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/zones/zone-1/domains/domain-1/verify',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
