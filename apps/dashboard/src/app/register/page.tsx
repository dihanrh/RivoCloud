import type { Metadata } from 'next';
import { RegisterScreen } from '@/components/auth/register-screen';

export const metadata: Metadata = { title: 'Create your account - RivoCloud' };

export default function RegisterPage() {
  return <RegisterScreen />;
}
