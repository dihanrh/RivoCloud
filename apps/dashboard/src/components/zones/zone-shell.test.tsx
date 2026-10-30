import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ZoneGate } from './zone-shell';
import { makeZone, mockApi, renderWithClient } from './test-utils';

describe('ZoneGate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the page with the loaded website', async () => {
    mockApi([{ url: '/api/zones/zone-1', body: makeZone({ id: 'zone-1', name: 'blog' }) }]);
    renderWithClient(<ZoneGate zoneId="zone-1">{(zone) => <p>Loaded {zone.name}</p>}</ZoneGate>);
    expect(await screen.findByText('Loaded blog')).toBeInTheDocument();
  });

  it('shows a not found state for an unknown website', async () => {
    mockApi([{ url: '/api/zones/missing', status: 404, body: { message: 'Zone not found' } }]);
    renderWithClient(<ZoneGate zoneId="missing">{() => <p>never</p>}</ZoneGate>);
    expect(await screen.findByText('Website not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to websites' })).toHaveAttribute('href', '/zones');
  });

  it('shows an error banner when loading fails', async () => {
    mockApi([{ url: '/api/zones/zone-1', status: 500, body: { message: 'boom' } }]);
    renderWithClient(<ZoneGate zoneId="zone-1">{() => <p>never</p>}</ZoneGate>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load this website/i);
  });
});
