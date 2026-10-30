import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ZoneList } from './zone-list';
import { makeZone } from './test-utils';

describe('ZoneList', () => {
  it('renders one row per website with its edge hostname, origin, status, and signed URL badge', () => {
    render(
      <ZoneList
        zones={[
          makeZone({ id: 'aaaaaaaa-1', name: 'blog', slug: 'blog', signedUrlsRequired: true }),
          makeZone({ id: 'bbbbbbbb-2', name: 'assets', slug: 'assets', enabled: false }),
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'blog' })).toHaveAttribute('href', '/zones/aaaaaaaa-1');
    expect(screen.getByText('blog-aaaaaaaa.cdn.rivocloud.dev')).toBeInTheDocument();
    expect(screen.getByText('assets-bbbbbbbb.cdn.rivocloud.dev')).toBeInTheDocument();
    expect(screen.getAllByText('https://origin.example.com')).toHaveLength(2);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});
