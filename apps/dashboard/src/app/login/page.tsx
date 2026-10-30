import { LoginScreen } from '@/components/auth/login-screen';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LoginScreen next={Array.isArray(next) ? next[0] : next} />;
}
