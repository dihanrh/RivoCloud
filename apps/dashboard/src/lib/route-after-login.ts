import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { apiFetch } from './http';
import type { LoginResult } from '@/components/auth/login-form';

export async function routeAfterLogin(result: LoginResult, router: AppRouterInstance): Promise<void> {
  if (result.org) {
    router.push('/dashboard');
    return;
  }

  const orgs = result.orgs ?? [];
  if (orgs.length === 0) {
    router.push('/orgs/new');
    return;
  }
  if (orgs.length === 1) {
    await apiFetch('/api/orgs/select', { method: 'POST', body: JSON.stringify({ orgId: orgs[0].id }) });
    router.push('/dashboard');
    return;
  }
  router.push('/orgs');
}
