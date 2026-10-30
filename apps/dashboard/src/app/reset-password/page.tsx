import type { Metadata } from 'next';
import { ResetPasswordScreen } from '@/components/auth/reset-password-screen';

export const metadata: Metadata = { title: 'Choose a new password - RivoCloud' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return <ResetPasswordScreen token={Array.isArray(token) ? token[0] : token} />;
}
