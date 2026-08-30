import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ZoneDetail } from './zone-detail';
import type { Zone } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const zone: Zone = {
  id: 'zone-1',
  orgId: 'org-1',
  projectId: null,
  name: 'my-zone',
  slug: 'my-zone',
  originUrl: 'https://origin.example.com',
  originProtocol: 'https',
  cacheTtl: 3600,
  browserTtl: 3600,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ZoneDetail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the zone name and origin URL', () => {
    renderWithProviders(<ZoneDetail zone={zone} />);
    expect(screen.getByDisplayValue('my-zone')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://origin.example.com')).toBeInTheDocument();
  });

  it('calls the PATCH endpoint with edited fields on save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...zone, name: 'renamed' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<ZoneDetail zone={zone} />);
    const nameInput = screen.getByDisplayValue('my-zone');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'renamed');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/zones/zone-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'renamed', originUrl: 'https://origin.example.com' }) }),
    );
  });
});
