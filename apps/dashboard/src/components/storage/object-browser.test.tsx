import '@/components/ui/test-polyfills';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const table = within(screen.getByRole('table', { name: 'Files' }));
    expect(table.getByText('Ready')).toHaveClass('text-success');
    expect(table.getByText('Uploading')).toHaveClass('text-warning');
    expect(screen.queryByText('pending')).not.toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
  });

  it('labels deleted objects in sentence case with a destructive tone', () => {
    render(<ObjectBrowser objects={[makeObject({ status: 'deleted' })]} onDelete={vi.fn()} />);
    expect(within(screen.getByRole('table', { name: 'Files' })).getByText('Deleted')).toHaveClass('text-destructive');
  });

  it('searches by key', async () => {
    const user = userEvent.setup();
    render(<ObjectBrowser objects={[makeObject(), makeObject({ id: 'obj-2', key: 'report.pdf' })]} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search files' }), 'report');
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('offers a share link only for ready objects, and only when sharing is wired up', async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();
    const objects = [makeObject({ key: 'photo.png' }), makeObject({ id: 'obj-2', key: 'draft.txt', status: 'pending', size: null })];

    const { unmount } = render(<ObjectBrowser objects={objects} onDelete={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Actions for photo.png' }));
    expect(within(await screen.findByRole('menu')).queryByRole('menuitem', { name: /share link/i })).not.toBeInTheDocument();
    unmount();

    render(<ObjectBrowser objects={objects} onDelete={vi.fn()} onShare={onShare} />);
    await user.click(screen.getByRole('button', { name: 'Actions for draft.txt' }));
    expect(within(await screen.findByRole('menu')).queryByRole('menuitem', { name: /share link/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Actions for photo.png' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /share link/i }));
    await vi.waitFor(() => expect(onShare).toHaveBeenCalledWith('photo.png'));
  });
});
