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
    <AuthLayout title="Create your account" description="Start with a free account. You can add websites and buckets right away.">
      <RegisterForm onSuccess={(result: LoginResult) => void routeAfterLogin(result, router)} />
      <p className="text-[13px] text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
