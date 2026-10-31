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

    const range = await screen.findByRole('radiogroup', { name: 'Range' });
    expect(screen.getByRole('radio', { name: 'Last 24 hours' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    expect(range).toBeInTheDocument();

    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0];
    expect(arg.rangeKey).toBe('7d');
    expect(arg.from).toBeTruthy();
    expect(arg.to).toBeTruthy();
  });

  it('moves through the ranges with the arrow keys', async () => {
    const onChange = vi.fn();
    renderWithClient(<AnalyticsFilters params={{ rangeKey: '24h' }} onChange={onChange} showZone={false} />);
    expect(screen.queryByLabelText('Website')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Last 24 hours' }), { key: 'ArrowRight' });
    expect(onChange.mock.calls[0][0].rangeKey).toBe('7d');
  });
});
