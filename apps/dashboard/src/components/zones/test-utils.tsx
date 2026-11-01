// Shared helpers for the zones component tests (not shipped in the app bundle).
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { OrgRole, Zone } from '@/lib/types';

export interface MockRoute {
  method?: string;
  url: string | RegExp;
  status?: number;
  body?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Stubs global fetch with a tiny router. `/api/me` answers with the given role;
 * unmatched requests get a 404 so a missing mock fails loudly in assertions.
 */
export function mockApi(routes: MockRoute[], role: OrgRole = 'owner') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/me') {
      return json({ id: 'user-1', email: 'a@example.com', name: 'Ada', avatarUrl: null, emailVerified: true, orgId: 'org-1', role });
    }
    const route = routes.find(
      (r) => (r.method ?? 'GET').toUpperCase() === method && (typeof r.url === 'string' ? r.url === url : r.url.test(url)),
    );
    if (!route) return json({ message: `No mock for ${method} ${url}` }, 404);
    return json(route.body ?? {}, route.status ?? 200);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Calls to fetch other than the /api/me lookup. */
export function apiCalls(fetchMock: ReturnType<typeof mockApi>, method?: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url) !== '/api/me' && (!method || (init?.method ?? 'GET').toUpperCase() === method),
  );
}

export function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TooltipProvider>{ui}</TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

export function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: 'zone-1-abcdef',
    orgId: 'org-1',
    projectId: null,
    name: 'my-zone',
    slug: 'my-zone',
    originUrl: 'https://origin.example.com',
    originProtocol: 'https',
    cacheTtl: 3600,
    browserTtl: 3600,
    enabled: true,
    signedUrlsRequired: false,
    hasSigningSecret: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
