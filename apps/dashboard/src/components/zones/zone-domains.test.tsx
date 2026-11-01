import '@/components/ui/test-polyfills';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoneDomains } from './zone-domains';
import { apiCalls, makeZone, mockApi, renderWithClient } from './test-utils';
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
const zone = makeZone({ id: 'zone-1', name: 'blog' });

describe('ZoneDomains', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders an empty state when there are no domains', async () => {
    mockApi([{ url: LIST, body: [] }]);
    renderWithClient(<ZoneDomains zone={zone} />);
    expect(await screen.findByText(/no custom domains yet/i)).toBeInTheDocument();
  });

  it.each([
    ['pending_dns', 'Waiting for DNS'],
    ['pending_ssl', 'Issuing certificate'],
    ['active', 'Active'],
  ] as const)('labels the %s status as "%s"', async (sslStatus, label) => {
    mockApi([{ url: LIST, body: [makeDomain({ sslStatus })] }]);
    renderWithClient(<ZoneDomains zone={zone} />);
    expect(await screen.findByText('cdn.example.com')).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows the error message when a domain is in the error state', async () => {
    mockApi([{ url: LIST, body: [makeDomain({ sslStatus: 'error', sslError: 'DNS did not resolve' })] }]);
    renderWithClient(<ZoneDomains zone={zone} />);
    expect(await screen.findByText('DNS did not resolve')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('shows the CNAME target in the instructions once a domain exists', async () => {
    mockApi([{ url: LIST, body: [makeDomain()] }]);
    renderWithClient(<ZoneDomains zone={zone} />);
    expect(await screen.findAllByText('edge.rivocloud.dev')).toHaveLength(2);
  });

  it('adds a domain from the dialog', async () => {
    const fetchMock = mockApi([
      { url: LIST, body: [] },
      { method: 'POST', url: LIST, status: 201, body: makeDomain() },
    ]);
    renderWithClient(<ZoneDomains zone={zone} />);

    await userEvent.click((await screen.findAllByRole('button', { name: /add domain/i }))[0]);
    await userEvent.type(screen.getByLabelText('Domain'), 'CDN.example.com');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add domain' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST')).toHaveLength(1));
    expect(JSON.parse(String(apiCalls(fetchMock, 'POST')[0][1]?.body))).toEqual({ domain: 'cdn.example.com' });
    expect(await screen.findByText('Domain added')).toBeInTheDocument();
  });

  it('verifies a pending domain from the row menu and toasts the result', async () => {
    const fetchMock = mockApi([
      { url: LIST, body: [makeDomain()] },
      { method: 'POST', url: `${LIST}/domain-1/verify`, status: 201, body: makeDomain({ sslStatus: 'pending_ssl' }) },
    ]);
    renderWithClient(<ZoneDomains zone={zone} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for cdn.example.com' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Verify now' }));
    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST').map(([url]) => url)).toEqual([`${LIST}/domain-1/verify`]));
    expect(await screen.findByText('Domain verified')).toBeInTheDocument();
  });

  it('deletes a domain after confirmation', async () => {
    const fetchMock = mockApi([
      { url: LIST, body: [makeDomain()] },
      { method: 'DELETE', url: `${LIST}/domain-1`, body: { success: true } },
    ]);
    renderWithClient(<ZoneDomains zone={zone} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for cdn.example.com' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete/i }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete domain' }));
    await vi.waitFor(() => expect(apiCalls(fetchMock, 'DELETE')).toHaveLength(1));
    expect(await screen.findByText('Domain deleted')).toBeInTheDocument();
  });

  it('gives a viewer no add, verify, or delete actions', async () => {
    mockApi([{ url: LIST, body: [makeDomain()] }], 'viewer');
    renderWithClient(<ZoneDomains zone={zone} />);

    expect(await screen.findByText('cdn.example.com')).toBeInTheDocument();
    expect(await screen.findByText('View only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add domain/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for cdn.example.com' }));
    expect(await screen.findByRole('menuitem', { name: 'Copy CNAME target' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /verify|delete/i })).not.toBeInTheDocument();
  });
});
