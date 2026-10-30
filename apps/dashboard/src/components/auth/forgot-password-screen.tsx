'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/http';
import { fieldErrors, forgotPasswordSchema } from '@/lib/validation';
import { authErrorMessage } from './auth-errors';
import { AuthLayout, StateIcon } from './auth-layout';
import { authInputClass, FormBanner, FormField } from './form-field';

const BACK_TO_LOGIN = (
  <p className="text-center">
    <Link href="/login" className="inline-flex items-center gap-1.5 rounded-sm font-medium text-primary hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to log in
    </Link>
  </p>
);

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).email);
      emailRef.current?.focus();
      return;
    }
    setError(undefined);

    setSubmitting(true);
    try {
      await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify(parsed.data) });
      setSentTo(parsed.data.email);
    } catch (err) {
      // Only rate limiting and outages are surfaced. Anything else gets the same
      // neutral confirmation, so the page never reveals whether an account exists.
      if (err instanceof ApiError && err.status !== 429 && err.status < 500) {
        setSentTo(parsed.data.email);
      } else {
        setServerError(authErrorMessage(err, { 429: 'Too many reset requests. Try again later.' }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout
        icon={
          <StateIcon tone="success">
            <MailCheck aria-hidden />
          </StateIcon>
        }
        title="Check your email"
        description={
          <>
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, we&apos;ve sent a
            reset link. It expires in one hour.
          </>
        }
        aside={BACK_TO_LOGIN}
      >
        <div role="status" className="rounded-lg border border-border bg-muted/60 px-4 py-3.5 text-[13px] leading-relaxed text-muted-foreground">
          Didn&apos;t get it? Check your spam folder, or{' '}
          <button
            type="button"
            className="rounded-sm font-medium text-primary hover:underline"
            onClick={() => {
              setSentTo(null);
            }}
          >
            try a different email
          </button>
          .
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email you use for RivoCloud and we'll send you a link to choose a new password."
      aside={BACK_TO_LOGIN}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate aria-busy={submitting}>
        {serverError && <FormBanner>{serverError}</FormBanner>}
        <FormField id="email" label="Email" error={error}>
          {(aria) => (
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              placeholder="you@company.com"
              className={authInputClass}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(undefined);
              }}
              {...aria}
            />
          )}
        </FormField>
        <Button type="submit" size="lg" className="mt-1 h-11 w-full text-[14px]" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" aria-hidden />}
          {submitting ? 'Sending link…' : 'Send reset link'}
        </Button>
      </form>
    </AuthLayout>
  );
}
