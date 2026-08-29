'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/http';
import { registerSchema } from '@/lib/validation';
import type { LoginResult } from './login-form';

export function RegisterForm({ onSuccess }: { onSuccess: (result: LoginResult) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(parsed.data) });
      const loginResult = await apiFetch<LoginResult>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password }),
      });
      onSuccess(loginResult);
    } catch (err) {
      const message = err instanceof ApiError ? ((err.body as { message?: string })?.message ?? 'Registration failed') : 'Registration failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
