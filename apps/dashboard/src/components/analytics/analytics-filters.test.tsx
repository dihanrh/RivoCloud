import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsFilters } from './analytics-filters';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AnalyticsFilters', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ zones: [{ id: 'zone-1', name: 'My Blog' }] }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('calls onChange with the selected zoneId', async () => {
    const onChange = vi.fn();
    renderWithClient(<AnalyticsFilters params={{ rangeKey: '24h' }} onChange={onChange} />);

    const zoneSelect = await screen.findByLabelText('Website');
    // Wait for the zones query to resolve and populate the <option> before selecting it —
    // otherwise jsdom silently ignores setting .value to an option that doesn't exist yet.
    await screen.findByText('My Blog');
    fireEvent.change(zoneSelect, { target: { value: 'zone-1' } });

    expect(onChange).toHaveBeenCalledWith({ rangeKey: '24h', zoneId: 'zone-1' });
  });

  it('calls onChange with a new from/to when the range changes', async () => {
    const onChange = vi.fn();
    renderWithClient(<AnalyticsFilters params={{ rangeKey: '24h' }} onChange={onChange} />);

    const rangeSelect = await screen.findByLabelText('Range');
    fireEvent.change(rangeSelect, { target: { value: '7d' } });

    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0];
    expect(arg.rangeKey).toBe('7d');
    expect(arg.from).toBeTruthy();
    expect(arg.to).toBeTruthy();
  });
});
