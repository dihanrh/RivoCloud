'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm, type LoginResult } from '@/components/auth/login-form';
import { routeAfterLogin } from '@/lib/route-after-login';

export default function LoginPage() {
  const router = useRouter();

  function handleSuccess(result: LoginResult) {
    void routeAfterLogin(result, router);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
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
    </main>
  );
}
