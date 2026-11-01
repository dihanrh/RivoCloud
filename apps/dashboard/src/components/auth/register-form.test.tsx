import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterForm } from './register-form';
import { scorePassword } from './password-strength';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function fill({
  name = 'Jane Doe',
  email = 'jane@example.com',
  password = 'Str0ng-pass',
  confirm,
  terms = true,
}: { name?: string; email?: string; password?: string; confirm?: string; terms?: boolean } = {}) {
  confirm ??= password;
  if (name) await userEvent.type(screen.getByLabelText('Full name'), name);
  if (email) await userEvent.type(screen.getByLabelText('Work email'), email);
  if (password) await userEvent.type(screen.getByLabelText('Password'), password);
  if (confirm) await userEvent.type(screen.getByLabelText('Confirm password'), confirm);
  if (terms) await userEvent.click(screen.getByRole('checkbox', { name: /i agree/i }));
}

describe('scorePassword', () => {
  it('labels passwords Weak, Fair, Good and Strong', () => {
    expect(scorePassword('abc').label).toBe('Weak');
    expect(scorePassword('Abc1!').label).toBe('Weak'); // too short caps it
    expect(scorePassword('abcdefgh').label).toBe('Weak');
    expect(scorePassword('abcdefg1').label).toBe('Fair');
    expect(scorePassword('Abcdefg1').label).toBe('Good');
    expect(scorePassword('Abcdef1!').label).toBe('Strong');
  });
});

describe('RegisterForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows a live strength label as the password changes', async () => {
    render(<RegisterForm onSuccess={vi.fn()} />);
    const input = screen.getByLabelText('Password');

    await userEvent.type(input, 'abc');
    expect(screen.getByTestId('password-strength')).toHaveTextContent('Password strength: Weak');
    await userEvent.clear(input);
    await userEvent.type(input, 'abcdefg1');
    expect(screen.getByTestId('password-strength')).toHaveTextContent('Fair');
    await userEvent.type(input, 'A');
    expect(screen.getByTestId('password-strength')).toHaveTextContent('Good');
    await userEvent.type(input, '!');
    expect(screen.getByTestId('password-strength')).toHaveTextContent('Strong');
  });

  it('flags a confirm-password mismatch without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm onSuccess={vi.fn()} />);

    await fill({ confirm: 'Different-1' });
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the terms checkbox', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm onSuccess={vi.fn()} />);

    await fill({ terms: false });
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/accept the terms/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /i agree/i })).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the backend minimum password length', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm onSuccess={vi.fn()} />);

    await fill({ password: 'Ab1!', confirm: 'Ab1!' });
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers, then logs in and hands the login result on', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'u1' }, 201))
      .mockResolvedValueOnce(jsonResponse({ org: null, orgs: [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RegisterForm onSuccess={onSuccess} />);

    await fill();
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ org: null, orgs: [] }));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/register');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Str0ng-pass',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/login');
  });

  it('explains an already-registered email with a link to log in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'exists' }, 409)));
    render(<RegisterForm onSuccess={vi.fn()} />);

    await fill();
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('An account with this email already exists.');
    expect(screen.getByRole('link', { name: /log in instead/i })).toHaveAttribute('href', '/login');
  });
});
