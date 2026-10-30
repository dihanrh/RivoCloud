import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginScreen } from './login-screen';
import { safeNextPath } from './safe-next';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('LoginScreen', () => {
  it('renders the brand logo, the form and a link to register', () => {
    render(<LoginScreen />);

    expect(screen.getByAltText('RivoCloud')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/register');
  });
});

describe('safeNextPath', () => {
  it('keeps same-site paths and rejects anything else', () => {
    expect(safeNextPath('/storage/abc')).toBe('/storage/abc');
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
  });
});
