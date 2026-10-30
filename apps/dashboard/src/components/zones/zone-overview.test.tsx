import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ZoneOverview } from './zone-overview';
import { makeZone, mockApi, renderWithClient } from './test-utils';

const zone = makeZone({ id: 'abcdef12-0000', slug: 'blog', name: 'blog' });

function routes() {
  return [
    { url: /^\/api\/analytics\/overview\?zoneId=abcdef12-0000&from=/, body: { requests: 12345, bytesSent: 2048, hitRatio: 0.875 } },
    { url: '/api/zones/abcdef12-0000/domains', body: [] },
  ];
}

describe('ZoneOverview', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the edge hostname, last-24h stats, and the summary', async () => {
    mockApi(routes());
    renderWithClient(<ZoneOverview zone={zone} />);

    expect(screen.getByText('blog-abcdef12.cdn.rivocloud.dev')).toBeInTheDocument();
    expect(await screen.findByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument();
    // Edge and browser TTLs are both 3600 seconds.
    expect(screen.getAllByText('1 hour', { selector: 'dd' })).toHaveLength(2);
    expect(await screen.findByRole('button', { name: 'Purge everything' })).toBeInTheDocument();
  });

  it('does not offer a purge to a viewer', async () => {
    mockApi(routes(), 'viewer');
    renderWithClient(<ZoneOverview zone={zone} />);

    expect(await screen.findByText('12,345')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Purge everything' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /caching/i })).toHaveAttribute('href', '/zones/abcdef12-0000/caching');
  });
});
