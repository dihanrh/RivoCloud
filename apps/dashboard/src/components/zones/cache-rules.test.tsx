import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CacheRules } from './cache-rules';
import { apiCalls, mockApi, renderWithClient } from './test-utils';
import type { CacheRule } from '@/lib/types';

function makeRule(overrides: Partial<CacheRule> = {}): CacheRule {
  return {
    id: 'rule-1',
    zoneId: 'zone-1',
    pattern: '/images/*',
    patternType: 'glob',
    action: 'cache',
    edgeTtl: 86400,
    browserTtl: null,
    queryString: 'strip_all',
    queryWhitelist: [],
    priority: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const RULES_URL = '/api/zones/zone-1/rules?take=100';

describe('CacheRules', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a rule with the right body, placed after the existing rules', async () => {
    const fetchMock = mockApi([
      { url: RULES_URL, body: { rules: [makeRule({ priority: 3 })], total: 1 } },
      { method: 'POST', url: '/api/zones/zone-1/rules', status: 201, body: makeRule({ id: 'rule-2' }) },
    ]);
    renderWithClient(<CacheRules zoneId="zone-1" />);

    await userEvent.click(await screen.findByRole('button', { name: /create rule/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('URL pattern'), '/api/*');
    await userEvent.selectOptions(within(dialog).getByLabelText('Action'), 'cache');
    await userEvent.type(within(dialog).getByLabelText('Edge TTL (seconds)'), '600');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST')).toHaveLength(1));
    const [url, init] = apiCalls(fetchMock, 'POST')[0];
    expect(url).toBe('/api/zones/zone-1/rules');
    expect(JSON.parse(String(init?.body))).toEqual({
      pattern: '/api/*',
      patternType: 'glob',
      action: 'cache',
      queryString: 'strip_all',
      queryWhitelist: [],
      edgeTtl: 600,
      priority: 2,
    });
  });

  it('requires query parameters when the whitelist option is chosen', async () => {
    const fetchMock = mockApi([
      { url: RULES_URL, body: { rules: [], total: 0 } },
      { method: 'POST', url: '/api/zones/zone-1/rules', status: 201, body: makeRule() },
    ]);
    renderWithClient(<CacheRules zoneId="zone-1" />);

    const [createButton] = await screen.findAllByRole('button', { name: /create rule/i });
    await userEvent.click(createButton);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('URL pattern'), '/search');
    await userEvent.selectOptions(within(dialog).getByLabelText('Query string in cache key'), 'whitelist');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/at least one query parameter/i);
    expect(apiCalls(fetchMock, 'POST')).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText('Query parameters to include'), 'q, page');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST')).toHaveLength(1));
    const body = JSON.parse(String(apiCalls(fetchMock, 'POST')[0][1]?.body));
    expect(body).toMatchObject({ pattern: '/search', queryString: 'whitelist', queryWhitelist: ['q', 'page'], priority: 0 });
  });

  it('moves a rule down by posting the new order', async () => {
    const rules = [makeRule({ id: 'a', pattern: '/a', priority: 1 }), makeRule({ id: 'b', pattern: '/b', priority: 0 })];
    const fetchMock = mockApi([
      { url: RULES_URL, body: { rules, total: 2 } },
      { method: 'POST', url: '/api/zones/zone-1/rules/reorder', body: { rules: [rules[1], rules[0]], total: 2 } },
    ]);
    renderWithClient(<CacheRules zoneId="zone-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Move /a down' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST')).toHaveLength(1));
    expect(JSON.parse(String(apiCalls(fetchMock, 'POST')[0][1]?.body))).toEqual({ order: ['b', 'a'] });
  });

  it('deletes a rule after confirmation', async () => {
    const fetchMock = mockApi([
      { url: RULES_URL, body: { rules: [makeRule()], total: 1 } },
      { method: 'DELETE', url: '/api/zones/zone-1/rules/rule-1', body: { success: true } },
    ]);
    renderWithClient(<CacheRules zoneId="zone-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete /images/*' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete rule' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'DELETE')).toHaveLength(1));
  });

  it('shows rules read-only to a viewer', async () => {
    mockApi([{ url: RULES_URL, body: { rules: [makeRule()], total: 1 } }], 'viewer');
    renderWithClient(<CacheRules zoneId="zone-1" />);

    expect(await screen.findByText('/images/*')).toBeInTheDocument();
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create rule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit|delete|move/i })).not.toBeInTheDocument();
  });
});
