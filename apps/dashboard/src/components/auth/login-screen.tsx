'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginForm, type LoginResult } from '@/components/auth/login-form';
import { routeAfterLogin } from '@/lib/route-after-login';
import { safeNextPath } from '@/components/auth/safe-next';

export function LoginScreen({ next }: { next?: string }) {
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
    <AuthLayout title="Log in" description="Welcome back. Log in to manage your websites and storage.">
      <LoginForm onSuccess={handleSuccess} />
      <p className="text-[13px] text-muted-foreground">
        New to RivoCloud?{' '}
        <Link href="/register" className="text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
