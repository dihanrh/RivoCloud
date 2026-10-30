import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomPurgeDialog, PurgeEverythingButton } from './purge-cache';
import { apiCalls, mockApi, renderWithClient } from './test-utils';

const result = { invalidationId: 'inv-123', status: 'pending' };

describe('PurgeEverythingButton', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('purges only after the user confirms', async () => {
    const fetchMock = mockApi([{ method: 'POST', url: '/api/zones/zone-1/cache/purge', status: 202, body: result }]);
    const onPurged = vi.fn();
    renderWithClient(<PurgeEverythingButton zoneId="zone-1" zoneName="blog" onPurged={onPurged} />);

    await userEvent.click(screen.getByRole('button', { name: 'Purge everything' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/every cached file for blog/i);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(apiCalls(fetchMock)).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Purge everything' }));
    const dialogButtons = screen.getAllByRole('button', { name: 'Purge everything' });
    await userEvent.click(dialogButtons[dialogButtons.length - 1]);

    await vi.waitFor(() => expect(onPurged).toHaveBeenCalledWith(result));
    expect(apiCalls(fetchMock, 'POST').map(([url]) => url)).toEqual(['/api/zones/zone-1/cache/purge']);
  });
});

describe('CustomPurgeDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function open() {
    await userEvent.click(screen.getByRole('button', { name: 'Custom purge' }));
  }

  it('splits lines into patterns and tags, dropping blanks and duplicates', async () => {
    const fetchMock = mockApi([{ method: 'POST', url: '/api/zones/zone-1/cache/invalidate', status: 202, body: result }]);
    const onPurged = vi.fn();
    renderWithClient(<CustomPurgeDialog zoneId="zone-1" onPurged={onPurged} />);
    await open();

    await userEvent.type(screen.getByLabelText('URL paths'), '/images/*{enter}{enter}  /css/site.css {enter}/images/*');
    await userEvent.type(screen.getByLabelText('Cache tags'), 'product-1{enter}home');
    await userEvent.click(screen.getByRole('button', { name: 'Purge' }));

    await vi.waitFor(() => expect(onPurged).toHaveBeenCalledWith(result));
    const [url, init] = apiCalls(fetchMock, 'POST')[0];
    expect(url).toBe('/api/zones/zone-1/cache/invalidate');
    expect(JSON.parse(String(init?.body))).toEqual({ patterns: ['/images/*', '/css/site.css'], tags: ['product-1', 'home'] });
  });

  it('sends only tags when no paths are given', async () => {
    const fetchMock = mockApi([{ method: 'POST', url: '/api/zones/zone-1/cache/invalidate', status: 202, body: result }]);
    renderWithClient(<CustomPurgeDialog zoneId="zone-1" />);
    await open();

    await userEvent.type(screen.getByLabelText('Cache tags'), 'home');
    await userEvent.click(screen.getByRole('button', { name: 'Purge' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST')).toHaveLength(1));
    expect(JSON.parse(String(apiCalls(fetchMock, 'POST')[0][1]?.body))).toEqual({ tags: ['home'] });
  });

  it('asks for at least one entry and rejects more than 100 paths', async () => {
    const fetchMock = mockApi([]);
    renderWithClient(<CustomPurgeDialog zoneId="zone-1" />);
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Purge' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/at least one url path or cache tag/i);

    const many = Array.from({ length: 101 }, (_, i) => `/p${i}`).join('\n');
    await userEvent.click(screen.getByLabelText('URL paths'));
    await userEvent.paste(many);
    await userEvent.click(screen.getByRole('button', { name: 'Purge' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/at most 100 url paths/i);
    expect(apiCalls(fetchMock, 'POST')).toHaveLength(0);
  });
});
