'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RegisterForm } from '@/components/auth/register-form';
import type { LoginResult } from '@/components/auth/login-form';
import { routeAfterLogin } from '@/lib/route-after-login';

export default function RegisterPage() {
  const router = useRouter();

  function handleSuccess(result: LoginResult) {
    void routeAfterLogin(result, router);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle>Create your RivoCloud account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RegisterForm onSuccess={handleSuccess} />
          <p className="text-sm text-muted-foreground">
            Already have an account? <Link href="/login" className="underline">Log in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
