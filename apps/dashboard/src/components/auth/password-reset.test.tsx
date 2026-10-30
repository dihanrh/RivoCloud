import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordScreen } from './forgot-password-screen';
import { ResetPasswordScreen } from './reset-password-screen';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('ForgotPasswordScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the same neutral confirmation whether or not the account exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordScreen />);

    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/if an account exists for/i)).toHaveTextContent(
      "If an account exists for nobody@example.com, we've sent a reset link.",
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/forgot-password', expect.objectContaining({ method: 'POST' }));
  });

  it('validates the email before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordScreen />);

    await userEvent.type(screen.getByLabelText('Email'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)));
    render(<ForgotPasswordScreen />);

    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many/i);
  });
});

describe('ResetPasswordScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function submit(password = 'N3w-password') {
    await userEvent.type(screen.getByLabelText('New password'), password);
    await userEvent.type(screen.getByLabelText('Confirm new password'), password);
    await userEvent.click(screen.getByRole('button', { name: /update password/i }));
  }

  it('shows the expired-link state with a way to request a new link on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'Invalid or expired reset token' }, 401)),
    );
    render(<ResetPasswordScreen token="bad" />);

    await submit();

    expect(await screen.findByRole('heading', { name: /has expired/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('sends the token and new password, then confirms', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ResetPasswordScreen token="tok123" />);

    await submit();

    expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: 'tok123', newPassword: 'N3w-password' });
  });

  it('reuses the strength meter', async () => {
    render(<ResetPasswordScreen token="t" />);
    await userEvent.type(screen.getByLabelText('New password'), 'Abcdef1!');
    expect(screen.getByTestId('password-strength')).toHaveTextContent('Strong');
  });

  it('treats a link without a token as invalid', () => {
    render(<ResetPasswordScreen />);
    expect(screen.getByRole('heading', { name: /incomplete/i })).toBeInTheDocument();
  });
});
