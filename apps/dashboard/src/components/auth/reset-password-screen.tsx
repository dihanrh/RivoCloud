'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Link2Off, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, apiFetch } from '@/lib/http';
import { fieldErrors, resetPasswordFormSchema } from '@/lib/validation';
import { authErrorMessage } from './auth-errors';
import { AuthLayout, StateIcon } from './auth-layout';
import { FormBanner, FormField } from './form-field';
import { PasswordInput } from './password-input';
import { PasswordStrengthMeter } from './password-strength';

type Field = 'newPassword' | 'confirmPassword';

const BACK_TO_LOGIN = (
  <p className="text-center">
    <Link href="/login" className="inline-flex items-center gap-1.5 rounded-sm font-medium text-primary hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to log in
    </Link>
  </p>
);

function ExpiredLink({ missing }: { missing: boolean }) {
  return (
    <AuthLayout
      icon={
        <StateIcon tone="warning">
          <Link2Off aria-hidden />
        </StateIcon>
      }
      title={missing ? 'This reset link is incomplete' : 'This reset link has expired'}
      description={
        missing
          ? 'The link is missing its token. Open the link from your email again, or request a new one.'
          : 'Reset links work once and expire after an hour. Request a new one and use it right away.'
      }
      aside={BACK_TO_LOGIN}
    >
      <div role="alert" className="sr-only">
        {missing ? 'This reset link is incomplete.' : 'This reset link has expired or was already used.'}
      </div>
      <Button asChild size="lg" className="h-11 w-full text-[14px]">
        <Link href="/forgot-password">Request a new link</Link>
      </Button>
    </AuthLayout>
  );
}

export function ResetPasswordScreen({ token }: { token?: string }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'expired'>('form');
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  if (!token) return <ExpiredLink missing />;
  if (state === 'expired') return <ExpiredLink missing={false} />;

  if (state === 'done') {
    return (
      <AuthLayout
        icon={
          <StateIcon tone="success">
            <CheckCircle2 aria-hidden />
          </StateIcon>
        }
        title="Password updated"
        description="Your new password is set. Log in with it to get back to your console."
      >
        <div role="status" className="sr-only">
          Password updated.
        </div>
        <Button asChild size="lg" className="h-11 w-full text-[14px]">
          <Link href="/login">Log in</Link>
        </Button>
      </AuthLayout>
    );
  }

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);

    const parsed = resetPasswordFormSchema.safeParse({ newPassword, confirmPassword });
    if (!parsed.success) {
      const next = fieldErrors(parsed.error) as Partial<Record<Field, string>>;
      setErrors(next);
      (next.newPassword ? passwordRef : confirmRef).current?.focus();
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: parsed.data.newPassword }),
      });
      setState('done');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setState('expired');
      } else {
        setServerError(authErrorMessage(err, { 400: 'Check your new password and try again.' }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description="Pick something you don't use anywhere else. You'll use it to log in from now on."
      aside={BACK_TO_LOGIN}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate aria-busy={submitting}>
        {serverError && <FormBanner>{serverError}</FormBanner>}

        <FormField id="newPassword" label="New password" error={errors.newPassword} describedBy="new-password-strength">
          {(aria) => (
            <div className="flex flex-col gap-2">
              <PasswordInput
                ref={passwordRef}
                id="newPassword"
                name="newPassword"
                autoComplete="new-password"
                autoFocus
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  clearError('newPassword');
                }}
                {...aria}
              />
              <PasswordStrengthMeter id="new-password-strength" password={newPassword} />
            </div>
          )}
        </FormField>

        <FormField id="confirmPassword" label="Confirm new password" error={errors.confirmPassword}>
          {(aria) => (
            <PasswordInput
              ref={confirmRef}
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                clearError('confirmPassword');
              }}
              {...aria}
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="mt-1 h-11 w-full text-[14px]" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" aria-hidden />}
          {submitting ? 'Updating password…' : 'Update password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
