import '@/components/ui/test-polyfills';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const two = [makeBucket({ name: 'photos' }), makeBucket({ id: 'bucket-2', name: 'backups', public: true })];

describe('BucketList', () => {
  it('renders an empty state with the create action when there are no buckets', async () => {
    const onCreate = vi.fn();
    render(<BucketList buckets={[]} onCreate={onCreate} />);
    expect(screen.getByText(/no buckets yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Create bucket' })[0]!);
    expect(onCreate).toHaveBeenCalled();
  });

  it('renders one row per bucket with a link, its visibility and a count', () => {
    render(<BucketList buckets={two} />);

    expect(screen.getByRole('link', { name: 'photos' })).toHaveAttribute('href', '/storage/bucket-1');
    expect(screen.getByRole('link', { name: 'backups' })).toBeInTheDocument();
    const table = within(screen.getByRole('table', { name: 'Buckets' }));
    expect(table.getByText('Private')).toBeInTheDocument();
    expect(table.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText('2 buckets')).toBeInTheDocument();
  });

  it('filters by search and visibility', async () => {
    const user = userEvent.setup();
    render(<BucketList buckets={two} />);

    await user.type(screen.getByRole('searchbox', { name: 'Search buckets' }), 'back');
    expect(screen.queryByRole('link', { name: 'photos' })).not.toBeInTheDocument();
    expect(screen.getByText('1 bucket')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search buckets' }));

    await user.selectOptions(screen.getByLabelText('Visibility'), 'private');
    expect(screen.getByRole('link', { name: 'photos' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'backups' })).not.toBeInTheDocument();
  });

  it('offers Delete bucket in the row menu only when deleting is allowed', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<BucketList buckets={two} />);
    await user.click(screen.getByRole('button', { name: 'Actions for photos' }));
    let menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Open' })).toHaveAttribute('href', '/storage/bucket-1');
    expect(within(menu).getByRole('menuitem', { name: 'Copy name' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /delete bucket/i })).not.toBeInTheDocument();
    unmount();

    const onDelete = vi.fn();
    render(<BucketList buckets={two} onDelete={onDelete} />);
    await user.click(screen.getByRole('button', { name: 'Actions for photos' }));
    menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: /delete bucket/i }));
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith(two[0]));
  });
});
