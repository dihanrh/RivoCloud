import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoneDomains } from './zone-domains';
import { apiCalls, mockApi, renderWithClient } from './test-utils';
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

const LIST = '/api/zones/zone-1/domains';

describe('ZoneDomains', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders an empty state when there are no domains', async () => {
    mockApi([{ url: LIST, body: [] }]);
    renderWithClient(<ZoneDomains zoneId="zone-1" />);
    expect(await screen.findByText(/no custom domains yet/i)).toBeInTheDocument();
  });

  it.each([
    ['pending_dns', 'Waiting for DNS'],
    ['pending_ssl', 'Issuing certificate'],
    ['active', 'Active'],
  ] as const)('labels the %s status as "%s"', async (sslStatus, label) => {
    mockApi([{ url: LIST, body: [makeDomain({ sslStatus })] }]);
    renderWithClient(<ZoneDomains zoneId="zone-1" />);
    expect(await screen.findByText('cdn.example.com')).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows the error message when a domain is in the error state', async () => {
    mockApi([{ url: LIST, body: [makeDomain({ sslStatus: 'error', sslError: 'DNS did not resolve' })] }]);
    renderWithClient(<ZoneDomains zoneId="zone-1" />);
    expect(await screen.findByText('DNS did not resolve')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('shows the CNAME target in the instructions once a domain exists', async () => {
    mockApi([{ url: LIST, body: [makeDomain()] }]);
    renderWithClient(<ZoneDomains zoneId="zone-1" />);
    expect(await screen.findAllByText('edge.rivocloud.dev')).toHaveLength(2);
  });

  it('adds a domain from the dialog', async () => {
    const fetchMock = mockApi([
      { url: LIST, body: [] },
      { method: 'POST', url: LIST, status: 201, body: makeDomain() },
    ]);
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    await userEvent.click(await screen.findByRole('button', { name: /add domain/i }));
    await userEvent.type(screen.getByLabelText('Domain'), 'CDN.example.com');
    await userEvent.click(screen.getAllByRole('button', { name: /add domain/i }).at(-1)!);

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST')).toHaveLength(1));
    expect(JSON.parse(String(apiCalls(fetchMock, 'POST')[0][1]?.body))).toEqual({ domain: 'cdn.example.com' });
  });

  it('checks DNS for a pending domain', async () => {
    const fetchMock = mockApi([
      { url: LIST, body: [makeDomain()] },
      { method: 'POST', url: `${LIST}/domain-1/verify`, status: 201, body: makeDomain({ sslStatus: 'pending_ssl' }) },
    ]);
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Check DNS for cdn.example.com' }));
    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST').map(([url]) => url)).toEqual([`${LIST}/domain-1/verify`]));
  });

  it('removes a domain after confirmation', async () => {
    const fetchMock = mockApi([
      { url: LIST, body: [makeDomain()] },
      { method: 'DELETE', url: `${LIST}/domain-1`, body: { success: true } },
    ]);
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove cdn.example.com' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove domain' }));
    await vi.waitFor(() => expect(apiCalls(fetchMock, 'DELETE')).toHaveLength(1));
  });

  it('gives a viewer no add, check, or remove actions', async () => {
    mockApi([{ url: LIST, body: [makeDomain()] }], 'viewer');
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    expect(await screen.findByText('cdn.example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add domain|check dns|remove/i })).not.toBeInTheDocument();
  });
});
