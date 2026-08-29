import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { apiFetch } from './http';
import type { LoginResult } from '@/components/auth/login-form';

export async function routeAfterLogin(
  result: LoginResult,
  router: AppRouterInstance,
  next?: string | null,
): Promise<void> {
  if (result.org) {
    // Only honor the deep-link redirect once the user already has an org selected —
    // the zero-org and multi-org branches below are prerequisite onboarding/selection
    // steps that must run first regardless of where the user was headed.
    const isSafeRelativePath = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//');
    router.push(isSafeRelativePath ? next : '/dashboard');
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
