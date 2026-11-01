import type { Metadata } from 'next';
import { LoginScreen } from '@/components/auth/login-screen';

export const metadata: Metadata = { title: 'Log in - RivoCloud' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LoginScreen next={Array.isArray(next) ? next[0] : next} />;
}
