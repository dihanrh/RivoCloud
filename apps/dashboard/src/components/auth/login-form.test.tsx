import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './login-form';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function submitValid() {
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));
}

describe('LoginForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('shows an inline field error and never calls fetch for an invalid email', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginForm onSuccess={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', 'email-error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits valid credentials and calls onSuccess with the login response', async () => {
    const onSuccess = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ org: null, orgs: [] })));
    render(<LoginForm onSuccess={onSuccess} />);

    await submitValid();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ org: null, orgs: [] }));
  });

  it('autofocuses email and sets autocomplete hints', () => {
    render(<LoginForm onSuccess={vi.fn()} />);
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('toggles password visibility with an accessible pressed state', async () => {
    render(<LoginForm onSuccess={vi.fn()} />);
    const input = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show password' });

    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('warns when Caps Lock is on while typing the password', () => {
    render(<LoginForm onSuccess={vi.fn()} />);
    const input = screen.getByLabelText('Password');
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: 'A', modifierCapsLock: true });
    expect(screen.getByText('Caps Lock is on')).toBeInTheDocument();
    expect(input.getAttribute('aria-describedby')).toContain('password-caps');

    fireEvent.keyDown(input, { key: 'a', modifierCapsLock: false });
    expect(screen.queryByText('Caps Lock is on')).not.toBeInTheDocument();
  });

  it('shows "Incorrect email or password." on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Invalid email or password' }, 401)));
    render(<LoginForm onSuccess={vi.fn()} />);
    await submitValid();
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('shows the rate-limit message on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'ThrottlerException' }, 429)));
    render(<LoginForm onSuccess={vi.fn()} />);
    await submitValid();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in a minute.');
  });

  it('shows a connection message when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<LoginForm onSuccess={vi.fn()} />);
    await submitValid();
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach RivoCloud right now.");
  });

  it('hides the demo accounts panel unless NEXT_PUBLIC_DEMO_MODE is true', () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '');
    render(<LoginForm onSuccess={vi.fn()} />);
    expect(screen.queryByText('Demo accounts')).not.toBeInTheDocument();
  });

  it('fills (but does not submit) the form from a demo account in demo mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', 'true');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginForm onSuccess={vi.fn()} />);

    expect(screen.getByText('Demo accounts')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /admin demo account/i }));

    expect(screen.getByLabelText('Email')).toHaveValue('admin@demo.rivo');
    expect(screen.getByLabelText('Password')).toHaveValue('DemoPass123!');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
