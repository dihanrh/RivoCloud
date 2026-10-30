'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import type { LoginResult } from '@/components/auth/login-form';
import { RegisterForm } from '@/components/auth/register-form';
import { routeAfterLogin } from '@/lib/route-after-login';

export function RegisterScreen() {
  const router = useRouter();

  return (
    <AuthLayout
      title="Create your account"
      description="Free to start. Add your first website or bucket in a couple of minutes."
      aside={
        <p className="text-center">
          Already have an account?{' '}
          <Link href="/login" className="rounded-sm font-medium text-primary hover:underline">
            Log in
          </Link>
        </p>
      }
    >
      <RegisterForm onSuccess={(result: LoginResult) => void routeAfterLogin(result, router)} />
    </AuthLayout>
  );
}
