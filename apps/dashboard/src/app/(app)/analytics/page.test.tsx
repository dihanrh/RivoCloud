import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAnalyticsBandwidth } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import AnalyticsPage from './page';

// Charts need layout that jsdom lacks; keep one real data hook so requests are observable.
vi.mock('@/components/analytics/bandwidth-chart', () => ({
  BandwidthChart: ({ params }: { params: AnalyticsQueryParams }) => {
    useAnalyticsBandwidth(params);
    return <div>bandwidth chart</div>;
  },
}));
vi.mock('@/components/analytics/cache-ratio-gauge', () => ({ CacheRatioGauge: () => null }));
vi.mock('@/components/analytics/geography-table', () => ({ GeographyTable: () => null }));
vi.mock('@/components/analytics/status-code-chart', () => ({ StatusCodeChart: () => null }));
vi.mock('@/components/analytics/latency-chart', () => ({ LatencyChart: () => null }));

describe('AnalyticsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the chosen website as zoneId with the analytics requests', async () => {
    const fetchMock = vi.fn(async (path: string) =>
      path === '/api/zones'
        ? new Response(JSON.stringify({ zones: [{ id: 'zone-1', name: 'My Blog' }], total: 1 }), { status: 200 })
        : new Response(JSON.stringify({ series: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AnalyticsPage />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: 'My Blog' });
    expect(screen.getByRole('option', { name: 'All websites' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Website'), 'zone-1');

    await waitFor(() => expect(fetchMock.mock.calls.map(([path]) => path)).toContain('/api/analytics/bandwidth?zoneId=zone-1'));
  });
});
