import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoForm, validateDemoRequest } from './demo-form';

describe('DemoForm', () => {
  it('requires a name, a valid work email and a company', async () => {
    const user = userEvent.setup();
    render(<DemoForm />);
    await user.click(screen.getByRole('button', { name: 'Request a demo' }));
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your work email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your company name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveFocus();
  });

  it('rejects an invalid email, then shows a success state', async () => {
    const user = userEvent.setup();
    render(<DemoForm />);
    await user.type(screen.getByLabelText('Full name'), 'Maya Rahman');
    await user.type(screen.getByLabelText('Work email'), 'maya@northwind');
    await user.type(screen.getByLabelText('Company'), 'Northwind Shop');
    await user.click(screen.getByRole('button', { name: 'Request a demo' }));

    const email = screen.getByLabelText('Work email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(/valid email address/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.clear(email);
    await user.type(email, 'maya@northwind.com');
    await user.click(screen.getByRole('button', { name: 'Request a demo' }));

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Thanks, Maya.');
    expect(status).toHaveTextContent('maya@northwind.com');
  });

  it('validates email formats', () => {
    const base = { name: 'A', company: 'B' };
    expect(validateDemoRequest({ ...base, email: 'a@b.co' }).email).toBeUndefined();
    expect(validateDemoRequest({ ...base, email: 'a@b' }).email).toBeDefined();
    expect(validateDemoRequest({ ...base, email: 'a b@c.com' }).email).toBeDefined();
  });
});
