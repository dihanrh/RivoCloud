import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZoneList } from './zone-list';
import type { Zone } from '@/lib/types';

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
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
    ...overrides,
  };
}

describe('ZoneList', () => {
  it('renders an empty state when there are no zones', () => {
    render(<ZoneList zones={[]} />);
    expect(screen.getByText(/no zones yet/i)).toBeInTheDocument();
  });

  it('renders one row per zone with its name, origin, and status', () => {
    render(<ZoneList zones={[makeZone({ name: 'blog' }), makeZone({ id: 'zone-2', name: 'assets', enabled: false })]} />);

    expect(screen.getByText('blog')).toBeInTheDocument();
    expect(screen.getByText('assets')).toBeInTheDocument();
    expect(screen.getAllByText('https://origin.example.com')).toHaveLength(2);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});
