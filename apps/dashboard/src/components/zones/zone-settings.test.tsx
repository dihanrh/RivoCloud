import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoneSettings } from './zone-settings';
import { apiCalls, makeZone, mockApi, renderWithClient } from './test-utils';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const zone = makeZone({ id: 'zone-1', name: 'my-blog' });

describe('ZoneSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockReset();
  });

  it('deletes the website only after its name is typed, then returns to the list', async () => {
    const fetchMock = mockApi([{ method: 'DELETE', url: '/api/zones/zone-1', body: { success: true } }]);
    renderWithClient(<ZoneSettings zone={zone} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete website' }));
    const confirm = screen.getAllByRole('button', { name: 'Delete website' }).at(-1)!;
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/website name/i, { selector: '#delete-confirm' }), 'my-blo');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/website name/i, { selector: '#delete-confirm' }), 'g');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/zones'));
    expect(apiCalls(fetchMock, 'DELETE').map(([url]) => url)).toEqual(['/api/zones/zone-1']);
  });

  it('saves the origin URL and protocol together', async () => {
    const fetchMock = mockApi([{ method: 'PATCH', url: '/api/zones/zone-1', body: zone }]);
    renderWithClient(<ZoneSettings zone={zone} />);

    const origin = await screen.findByLabelText('Origin URL');
    // Fields unlock once the member's role has loaded.
    await vi.waitFor(() => expect(origin).toBeEnabled());
    await userEvent.clear(origin);
    await userEvent.type(origin, 'https://new.example.com');
    await userEvent.selectOptions(screen.getByLabelText('Origin protocol'), 'match');
    await userEvent.click(screen.getByRole('button', { name: 'Save origin' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'PATCH')).toHaveLength(1));
    expect(JSON.parse(String(apiCalls(fetchMock, 'PATCH')[0][1]?.body))).toEqual({
      originUrl: 'https://new.example.com',
      originProtocol: 'match',
    });
  });

  it('pauses the website through the enabled flag', async () => {
    const fetchMock = mockApi([{ method: 'PATCH', url: '/api/zones/zone-1', body: { ...zone, enabled: false } }]);
    renderWithClient(<ZoneSettings zone={zone} />);

    const toggle = await screen.findByRole('switch', { name: 'Pause website' });
    await vi.waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'PATCH')).toHaveLength(1));
    expect(JSON.parse(String(apiCalls(fetchMock, 'PATCH')[0][1]?.body))).toEqual({ enabled: false });
  });

  it('gives a viewer no way to change or delete the website', async () => {
    mockApi([], 'viewer');
    renderWithClient(<ZoneSettings zone={zone} />);

    expect(await screen.findByText(/read-only access/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save|delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Pause website' })).toBeDisabled();
    expect(screen.getByLabelText('Origin URL')).toBeDisabled();
  });
});
