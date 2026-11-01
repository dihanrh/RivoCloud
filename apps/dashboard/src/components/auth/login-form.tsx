'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/http';
import { fieldErrors, loginSchema } from '@/lib/validation';
import type { Organization } from '@/lib/types';
import { authErrorMessage, INVALID_CREDENTIALS } from './auth-errors';
import { DemoAccounts } from './demo-accounts';
import { authInputClass, FormBanner, FormField } from './form-field';
import { PasswordInput } from './password-input';

export interface LoginResult {
  org: string | null;
  orgs?: Organization[];
}

type Field = 'email' | 'password';

export function LoginForm({
  onSuccess,
  afterForm,
  showDemoAccounts = false,
}: {
  onSuccess: (result: LoginResult) => void;
  /** Rendered between the form and the demo panel (e.g. the link to sign up). */
  afterForm?: React.ReactNode;
  /** Show the demo accounts quick-fill panel (the "Demo Login" entry). */
  showDemoAccounts?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next = fieldErrors(parsed.error) as Partial<Record<Field, string>>;
      setErrors(next);
      (next.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      const result = await apiFetch<LoginResult>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onSuccess(result);
    } catch (err) {
      setServerError(authErrorMessage(err, { 400: INVALID_CREDENTIALS, 401: INVALID_CREDENTIALS }));
      setSubmitting(false);
      passwordRef.current?.select();
    }
    // On success the button stays busy while the router navigates away.
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate aria-busy={submitting}>
        {serverError && <FormBanner>{serverError}</FormBanner>}

        <FormField id="email" label="Email" error={errors.email}>
          {(aria) => (
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              placeholder="you@company.com"
              className={authInputClass}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearError('email');
              }}
              {...aria}
            />
          )}
        </FormField>

        <FormField
          id="password"
          label="Password"
          error={errors.password}
          labelAside={
            <Link href="/forgot-password" className="rounded-sm text-[13px] font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          }
        >
          {(aria) => (
            <PasswordInput
              ref={passwordRef}
              id="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError('password');
              }}
              {...aria}
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="mt-1 h-11 w-full text-[14px]" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" aria-hidden />}
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>

      {afterForm}

      {showDemoAccounts && (
        <DemoAccounts
          onPick={(demoEmail, demoPassword) => {
            setEmail(demoEmail);
            setPassword(demoPassword);
            setErrors({});
            setServerError(null);
            passwordRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
