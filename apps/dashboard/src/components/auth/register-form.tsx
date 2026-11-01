'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/http';
import { fieldErrors, registerFormSchema } from '@/lib/validation';
import { authErrorMessage } from './auth-errors';
import { authInputClass, errorId, FieldError, FormBanner, FormField } from './form-field';
import type { LoginResult } from './login-form';
import { PasswordInput } from './password-input';
import { PasswordStrengthMeter } from './password-strength';

type Field = 'name' | 'email' | 'password' | 'confirmPassword' | 'acceptTerms';
const FIELD_ORDER: Field[] = ['name', 'email', 'password', 'confirmPassword', 'acceptTerms'];

type ServerError = { kind: 'exists' } | { kind: 'message'; text: string };

export function RegisterForm({ onSuccess }: { onSuccess: (result: LoginResult) => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function focusField(field: Field) {
    formRef.current?.querySelector<HTMLInputElement>(`#${field}`)?.focus();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);

    const parsed = registerFormSchema.safeParse({ name, email, password, confirmPassword, acceptTerms });
    if (!parsed.success) {
      const next = fieldErrors(parsed.error) as Partial<Record<Field, string>>;
      setErrors(next);
      const first = FIELD_ORDER.find((field) => next[field]);
      if (first) focusField(first);
      return;
    }
    setErrors({});
    const body = { name: parsed.data.name, email: parsed.data.email, password: parsed.data.password };

    setSubmitting(true);
    try {
      await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setServerError({ kind: 'exists' });
        setErrors({ email: 'This email is already registered' });
      } else {
        setServerError({ kind: 'message', text: authErrorMessage(err, { 400: 'Check your details and try again.' }) });
      }
      setSubmitting(false);
      return;
    }

    try {
      const loginResult = await apiFetch<LoginResult>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: body.email, password: body.password }),
      });
      onSuccess(loginResult);
    } catch {
      // The account was created; only the immediate follow-up login failed. Send
      // the user to /login instead of inviting a re-submit (which would now 409).
      setServerError({ kind: 'message', text: 'Account created. Log in to continue.' });
      setSubmitting(false);
      router.push('/login');
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate aria-busy={submitting}>
      {serverError && (
        <FormBanner>
          {serverError.kind === 'exists' ? (
            <>
              An account with this email already exists.{' '}
              <Link href="/login" className="font-semibold underline underline-offset-2">
                Log in instead
              </Link>
              .
            </>
          ) : (
            serverError.text
          )}
        </FormBanner>
      )}

      <FormField id="name" label="Full name" error={errors.name}>
        {(aria) => (
          <Input
            id="name"
            name="name"
            autoComplete="name"
            autoFocus
            placeholder="Jane Doe"
            className={authInputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearError('name');
            }}
            {...aria}
          />
        )}
      </FormField>

      <FormField id="email" label="Work email" error={errors.email}>
        {(aria) => (
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@company.com"
            className={authInputClass}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError('email');
              if (serverError?.kind === 'exists') setServerError(null);
            }}
            {...aria}
          />
        )}
      </FormField>

      <FormField id="password" label="Password" error={errors.password} describedBy="password-strength">
        {(aria) => (
          <div className="flex flex-col gap-2">
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError('password');
              }}
              {...aria}
            />
            <PasswordStrengthMeter id="password-strength" password={password} />
          </div>
        )}
      </FormField>

      <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword}>
        {(aria) => (
          <PasswordInput
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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2.5">
          <input
            id="acceptTerms"
            name="acceptTerms"
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => {
              setAcceptTerms(e.target.checked);
              clearError('acceptTerms');
            }}
            aria-invalid={Boolean(errors.acceptTerms)}
            aria-describedby={errors.acceptTerms ? errorId('acceptTerms') : undefined}
            required
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border-strong accent-[var(--color-primary)]"
          />
          <label htmlFor="acceptTerms" className="cursor-pointer text-[13px] leading-snug text-muted-foreground">
            I agree to the{' '}
            <a href="#" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
              Terms
            </a>{' '}
            and{' '}
            <a href="#" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
              Privacy Policy
            </a>
          </label>
        </div>
        <FieldError id={errorId('acceptTerms')} message={errors.acceptTerms} />
      </div>

      <Button type="submit" size="lg" className="mt-1 h-11 w-full text-[14px]" disabled={submitting}>
        {submitting && <Loader2 className="animate-spin" aria-hidden />}
        {submitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
