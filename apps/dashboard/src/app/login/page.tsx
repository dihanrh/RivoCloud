'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm, type LoginResult } from '@/components/auth/login-form';
import { routeAfterLogin } from '@/lib/route-after-login';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleSuccess(result: LoginResult) {
    void routeAfterLogin(result, router, searchParams.get('next'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in to RivoCloud</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <LoginForm onSuccess={handleSuccess} />
        <p className="text-sm text-muted-foreground">
          No account? <Link href="/register" className="underline">Register</Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Suspense fallback={null}>
        <LoginPageContent />
      </Suspense>
    </main>
  );
}
