import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GeographyTable } from './geography-table';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('GeographyTable', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders an empty state when there is no country data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ countries: [] }), { status: 200 }));
    renderWithClient(<GeographyTable params={{}} />);
    expect(await screen.findByText(/no data for this range/i)).toBeInTheDocument();
  });

  it('renders a row per country', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ countries: [{ country: 'DE', requests: 42, bytesSent: 1000 }] }), { status: 200 }),
    );
    renderWithClient(<GeographyTable params={{}} />);
    expect(await screen.findByText('DE')).toBeInTheDocument();
    expect(screen.getByText('Germany')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
