import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BucketList } from './bucket-list';
import type { Bucket } from '@/lib/types';

function makeBucket(overrides: Partial<Bucket> = {}): Bucket {
  return {
    id: 'bucket-1',
    orgId: 'org-1',
    projectId: null,
    name: 'photos',
    region: 'us-east-1',
    versioningEnabled: false,
    public: false,
    lifecycleRules: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('BucketList', () => {
  it('renders an empty state when there are no buckets', () => {
    render(<BucketList buckets={[]} />);
    expect(screen.getByText(/no buckets yet/i)).toBeInTheDocument();
  });

  it('renders one row per bucket with its name and visibility', () => {
    render(<BucketList buckets={[makeBucket({ name: 'photos' }), makeBucket({ id: 'bucket-2', name: 'backups', public: true })]} />);

    expect(screen.getByText('photos')).toBeInTheDocument();
    expect(screen.getByText('backups')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
  });
});
