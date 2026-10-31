import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoneSignedUrls } from './zone-signed-urls';
import { apiCalls, makeZone, mockApi, renderWithClient } from './test-utils';

const zone = makeZone({ id: 'zone-1', name: 'private', browserTtl: 0 });

describe('ZoneSignedUrls', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns signed URLs on through the zone PATCH endpoint', async () => {
    const fetchMock = mockApi([{ method: 'PATCH', url: '/api/zones/zone-1', body: { ...zone, signedUrlsRequired: true } }]);
    renderWithClient(<ZoneSignedUrls zone={zone} />);

    const toggle = screen.getByRole('switch', { name: /require signed urls/i });
    await vi.waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'PATCH')).toHaveLength(1));
    expect(apiCalls(fetchMock, 'PATCH')[0]).toEqual([
      '/api/zones/zone-1',
      expect.objectContaining({ body: JSON.stringify({ signedUrlsRequired: true }) }),
    ]);
    expect(await screen.findByText('Signed URLs required')).toBeInTheDocument();
  });

  it('hides the rotate action until the zone has a secret', async () => {
    mockApi([]);
    renderWithClient(<ZoneSignedUrls zone={zone} />);
    await vi.waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('rotates the secret only after the user confirms the warning', async () => {
    const fetchMock = mockApi([
      { method: 'POST', url: '/api/zones/zone-1/signing-secret/rotate', status: 201, body: { ...zone, hasSigningSecret: true } },
    ]);
    renderWithClient(<ZoneSignedUrls zone={{ ...zone, signedUrlsRequired: true, hasSigningSecret: true }} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Rotate signing secret' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/stop working right away/i);
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(apiCalls(fetchMock, 'POST')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Rotate signing secret' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));

    expect(await screen.findByText('Signing secret rotated')).toBeInTheDocument();
    expect(screen.getByText(/previously shared links no longer work/i)).toBeInTheDocument();
    expect(apiCalls(fetchMock, 'POST').map(([url]) => url)).toEqual(['/api/zones/zone-1/signing-secret/rotate']);
  });

  it('shows the setting to a viewer without letting them change it', async () => {
    mockApi([], 'viewer');
    renderWithClient(<ZoneSignedUrls zone={{ ...zone, hasSigningSecret: true }} />);

    expect(await screen.findByText('Rotate signing secret')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /require signed urls/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });
});
