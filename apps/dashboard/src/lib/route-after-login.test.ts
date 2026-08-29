import { describe, expect, it, vi } from 'vitest';
import { routeAfterLogin } from './route-after-login';

vi.mock('./http', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from './http';

describe('routeAfterLogin', () => {
  it('goes straight to /dashboard when an org is already selected', async () => {
    const router = { push: vi.fn() };
    await routeAfterLogin({ org: 'org-1' }, router as never);
    expect(router.push).toHaveBeenCalledWith('/dashboard');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('redirects to the ?next= deep link when an org is already selected and next is a safe relative path', async () => {
    const router = { push: vi.fn() };
    await routeAfterLogin({ org: 'org-1' }, router as never, '/zones/abc');
    expect(router.push).toHaveBeenCalledWith('/zones/abc');
  });

  it('falls back to /dashboard when next is not a safe relative path (open-redirect guard)', async () => {
    const router = { push: vi.fn() };
    await routeAfterLogin({ org: 'org-1' }, router as never, 'https://evil.example.com');
    expect(router.push).toHaveBeenCalledWith('/dashboard');

    router.push.mockClear();
    await routeAfterLogin({ org: 'org-1' }, router as never, '//evil.example.com');
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  it('ignores next when the user has zero organizations (onboarding takes priority)', async () => {
    const router = { push: vi.fn() };
    await routeAfterLogin({ org: null, orgs: [] }, router as never, '/zones/abc');
    expect(router.push).toHaveBeenCalledWith('/orgs/new');
  });

  it('goes to /orgs/new when the user has zero organizations', async () => {
    const router = { push: vi.fn() };
    await routeAfterLogin({ org: null, orgs: [] }, router as never);
    expect(router.push).toHaveBeenCalledWith('/orgs/new');
  });

  it('auto-selects and continues to /dashboard when there is exactly one organization', async () => {
    const router = { push: vi.fn() };
    vi.mocked(apiFetch).mockResolvedValue({ org: 'org-1' });

    await routeAfterLogin({ org: null, orgs: [{ id: 'org-1', name: 'Acme', slug: 'acme', createdAt: '', updatedAt: '' }] }, router as never);

    expect(apiFetch).toHaveBeenCalledWith('/api/orgs/select', { method: 'POST', body: JSON.stringify({ orgId: 'org-1' }) });
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  it('goes to the /orgs switcher when there is more than one organization', async () => {
    const router = { push: vi.fn() };
    const orgs = [
      { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: '', updatedAt: '' },
      { id: 'org-2', name: 'Globex', slug: 'globex', createdAt: '', updatedAt: '' },
    ];
    await routeAfterLogin({ org: null, orgs }, router as never);
    expect(router.push).toHaveBeenCalledWith('/orgs');
  });
});
