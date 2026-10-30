'use client';

import { useId, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const PLAN_OPTIONS = ['Not sure yet', 'Free', 'Pro', 'Business', 'Enterprise'];

type Errors = Partial<Record<'name' | 'email' | 'company', string>>;

export function validateDemoRequest(values: { name: string; email: string; company: string }): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) errors.name = 'Enter your name.';
  if (!values.email.trim()) errors.email = 'Enter your work email.';
  else if (!EMAIL.test(values.email.trim())) errors.email = 'Enter a valid email address, like you@company.com.';
  if (!values.company.trim()) errors.company = 'Enter your company name.';
  return errors;
}

/**
 * The demo request form. Client-side only: it validates and shows a
 * confirmation, but does not send anything anywhere.
 */
export function DemoForm({ defaultPlan = 'Not sure yet', compact = false }: { defaultPlan?: string; compact?: boolean }) {
  const id = useId();
  const [values, setValues] = useState({ name: '', email: '', company: '', plan: defaultPlan, message: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  const update = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    if (field in errors) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = validateDemoRequest(values);
    setErrors(next);
    const firstInvalid = (['name', 'email', 'company'] as const).find((field) => next[field]);
    if (firstInvalid) {
      document.getElementById(`${id}-${firstInvalid}`)?.focus();
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    const firstName = values.name.trim().split(/\s+/)[0];
    return (
      <div role="status" className="mk-fade-up flex flex-col items-start gap-3 rounded-2xl border border-success/30 bg-success-soft/60 p-6">
        <CheckCircle2 className="h-7 w-7 text-success" aria-hidden />
        <h3 className="text-[18px] font-semibold text-foreground">Thanks, {firstName}. We&apos;ll be in touch.</h3>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Someone from our team will reply to <span className="font-medium text-foreground">{values.email.trim()}</span> within one
          business day to find a time that suits you.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setSubmitted(false);
            setValues({ name: '', email: '', company: '', plan: defaultPlan, message: '' });
          }}
        >
          Send another request
        </Button>
      </div>
    );
  }

  const field = (name: 'name' | 'email' | 'company', label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label htmlFor={`${id}-${name}`} className="text-[13px] font-medium text-foreground">
        {label}
      </label>
      <Input
        id={`${id}-${name}`}
        name={name}
        value={values[name]}
        onChange={update(name)}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
        className={cn('mt-1.5 h-10 text-[15px]', errors[name] && 'border-destructive focus-visible:border-destructive')}
        {...props}
      />
      {errors[name] && (
        <p id={`${id}-${name}-error`} className="mt-1.5 text-[13px] text-destructive">
          {errors[name]}
        </p>
      )}
    </div>
  );

  return (
    <form noValidate onSubmit={onSubmit} aria-label="Request a demo" className="grid gap-4">
      <div className={cn('grid gap-4', !compact && 'sm:grid-cols-2')}>
        {field('name', 'Full name', { autoComplete: 'name', placeholder: 'Maya Rahman' })}
        {field('email', 'Work email', { type: 'email', autoComplete: 'email', placeholder: 'maya@company.com' })}
      </div>
      <div className={cn('grid gap-4', !compact && 'sm:grid-cols-2')}>
        {field('company', 'Company', { autoComplete: 'organization', placeholder: 'Northwind Shop' })}
        <div>
          <label htmlFor={`${id}-plan`} className="text-[13px] font-medium text-foreground">
            Plan you are interested in
          </label>
          <Select id={`${id}-plan`} name="plan" value={values.plan} onChange={update('plan')} className="mt-1.5 h-10 text-[15px]">
            {PLAN_OPTIONS.map((plan) => (
              <option key={plan}>{plan}</option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-message`} className="text-[13px] font-medium text-foreground">
          What would you like to see? <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id={`${id}-message`}
          name="message"
          value={values.message}
          onChange={update('message')}
          rows={compact ? 3 : 4}
          placeholder="For example: moving 40 TB of images off our current CDN, and private downloads for customers."
          className="mt-1.5 font-sans text-[15px]"
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] text-muted-foreground">We only use your details to reply to this request.</p>
        <Button type="submit" size="lg" className="h-11 px-6 text-[15px]">
          Request a demo
        </Button>
      </div>
    </form>
  );
}
