import { cloneElement, isValidElement } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BandwidthChart } from './bandwidth-chart';
import { LatencyChart } from './latency-chart';

// jsdom has no layout, so ResponsiveContainer would measure 0x0 and draw nothing. Give the chart a
// fixed size instead so the SVG it draws on its first paint can be inspected.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      isValidElement(children) ? cloneElement(children as React.ReactElement<{ width: number; height: number }>, { width: 600, height: 256 }) : null,
  };
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 9, 30, 0);

/** Distinct y coordinates in an SVG path's `d`; a series still collapsed onto the axis has just one. */
function distinctYs(d: string | null): Set<number> {
  const nums = (d ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  return new Set(nums.filter((_, i) => i % 2 === 1).map((y) => Math.round(y)));
}

describe('time-series charts', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  // Regression: the series used Recharts' default draw-in animation, so the first paint after the
  // data arrived (and every refetch / filter change) showed empty axes — the latency lines were
  // stroke-dashed to zero length and the bandwidth area flattened onto the baseline.
  it('draws the latency lines fully on the first paint', async () => {
    const series = [0, 1, 2, 3].map((i) => ({ bucket: T0 + i * HOUR, p50: 15 + i, p95: 80 + 10 * i, p99: 210.4 + 5 * i }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ series }), { status: 200 }));
    const { container } = renderWithClient(<LatencyChart params={{}} />);

    await waitFor(() => expect(container.querySelectorAll('path.recharts-line-curve')).toHaveLength(3));
    for (const line of container.querySelectorAll('path.recharts-line-curve')) {
      expect(line.getAttribute('stroke-dasharray')).toBeNull();
      expect(distinctYs(line.getAttribute('d')).size).toBeGreaterThan(1);
    }
  });

  it('draws the bandwidth area fully on the first paint', async () => {
    const series = [0, 1, 2, 3].map((i) => ({ bucket: T0 + i * HOUR, bytesSent: 1_000_000 * (i + 1), requests: 10 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ series }), { status: 200 }));
    const { container } = renderWithClient(<BandwidthChart params={{}} />);

    await waitFor(() => expect(container.querySelector('path.recharts-area-curve')).not.toBeNull());
    // The draw-in animation reveals the area through a clip rect that grows from zero width.
    expect(container.querySelector('[id^="animationClipPath"]') !== null).toBe(false);
    expect(distinctYs(container.querySelector('path.recharts-area-curve')!.getAttribute('d')).size).toBeGreaterThan(1);
  });
});
