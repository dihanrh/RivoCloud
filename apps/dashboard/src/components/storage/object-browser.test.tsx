import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ObjectBrowser } from './object-browser';
import type { StorageObject } from '@/lib/types';

function makeObject(overrides: Partial<StorageObject> = {}): StorageObject {
  return {
    id: 'obj-1',
    bucketId: 'bucket-1',
    key: 'photo.png',
    versionId: 'v1',
    isLatest: true,
    size: '2048',
    contentType: 'image/png',
    etag: 'abc',
    storagePath: 'rc-bucket-1/photo.png/v1',
    metadata: null,
    status: 'ready',
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ObjectBrowser', () => {
  it('renders an empty state when there are no objects', () => {
    render(<ObjectBrowser objects={[]} onDelete={vi.fn()} />);
    expect(screen.getByText(/no files yet/i)).toBeInTheDocument();
  });

  it('renders each object with its formatted size and status', () => {
    render(
      <ObjectBrowser
        objects={[makeObject({ key: 'photo.png', size: '2048' }), makeObject({ id: 'obj-2', key: 'draft.txt', status: 'pending', size: null })]}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('draft.txt')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });
});
