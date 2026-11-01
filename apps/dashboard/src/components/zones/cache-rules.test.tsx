import '@/components/ui/test-polyfills';
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

  it('creates a rule from the sheet with the right body, placed after the existing rules, and toasts', async () => {
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
    expect(await screen.findByText('Cache rule created')).toBeInTheDocument();
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

    expect(within(dialog).getByText(/at least one query parameter/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Query parameters to include')).toHaveAttribute('aria-invalid', 'true');
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

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for /a' }));
    expect(await screen.findByRole('menuitem', { name: 'Move up' })).toHaveAttribute('data-disabled');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'POST')).toHaveLength(1));
    expect(JSON.parse(String(apiCalls(fetchMock, 'POST')[0][1]?.body))).toEqual({ order: ['b', 'a'] });
    expect(await screen.findByText('Rule moved down')).toBeInTheDocument();
  });

  it('edits a rule in the sheet, sending cleared TTLs as null', async () => {
    const fetchMock = mockApi([
      { url: RULES_URL, body: { rules: [makeRule()], total: 1 } },
      { method: 'PATCH', url: '/api/zones/zone-1/rules/rule-1', body: makeRule({ edgeTtl: null }) },
    ]);
    renderWithClient(<CacheRules zoneId="zone-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for /images/*' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit cache rule' });
    expect(within(sheet).getByLabelText('URL pattern')).toHaveValue('/images/*');
    await userEvent.clear(within(sheet).getByLabelText('Edge TTL (seconds)'));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save rule' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'PATCH')).toHaveLength(1));
    expect(JSON.parse(String(apiCalls(fetchMock, 'PATCH')[0][1]?.body))).toMatchObject({ pattern: '/images/*', edgeTtl: null, browserTtl: null });
    expect(await screen.findByText('Cache rule saved')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit cache rule' })).not.toBeInTheDocument());
  });

  it('deletes a rule after confirmation', async () => {
    const fetchMock = mockApi([
      { url: RULES_URL, body: { rules: [makeRule()], total: 1 } },
      { method: 'DELETE', url: '/api/zones/zone-1/rules/rule-1', body: { success: true } },
    ]);
    renderWithClient(<CacheRules zoneId="zone-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for /images/*' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(apiCalls(fetchMock, 'DELETE')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete rule' }));

    await vi.waitFor(() => expect(apiCalls(fetchMock, 'DELETE')).toHaveLength(1));
    expect(await screen.findByText('Cache rule deleted')).toBeInTheDocument();
  });

  it('shows rules read-only to a viewer', async () => {
    mockApi([{ url: RULES_URL, body: { rules: [makeRule()], total: 1 } }], 'viewer');
    renderWithClient(<CacheRules zoneId="zone-1" />);

    expect(await screen.findByText('/images/*')).toBeInTheDocument();
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create rule/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument();
  });
});
