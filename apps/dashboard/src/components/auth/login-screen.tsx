'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginForm, type LoginResult } from '@/components/auth/login-form';
import { routeAfterLogin } from '@/lib/route-after-login';
import { safeNextPath } from '@/components/auth/safe-next';

export function LoginScreen({ next, demo = false }: { next?: string; demo?: boolean }) {
  const router = useRouter();
  const target = safeNextPath(next);

  function handleSuccess(result: LoginResult) {
    // Return to the page the user was sent away from, once they have an account selected.
    if (target && result.org) {
      router.push(target);
      return;
    }
    void routeAfterLogin(result, router);
  }

  return (
    <AuthLayout
      title={demo ? 'Demo login' : 'Log in to RivoCloud'}
      description={
        demo
          ? 'Pick a demo account below to fill the form, then log in to explore the console.'
          : 'Welcome back. Manage your websites, caching and storage.'
      }
    >
      <LoginForm
        onSuccess={handleSuccess}
        showDemoAccounts={demo}
        afterForm={
          <p className="text-center text-[13.5px] text-muted-foreground">
            New to RivoCloud?{' '}
            <Link href="/register" className="rounded-sm font-medium text-primary hover:underline">
              Create an account
            </Link>
          </p>
        }
      />
    </AuthLayout>
  );
}
