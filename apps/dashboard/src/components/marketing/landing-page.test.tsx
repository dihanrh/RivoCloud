import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import LandingPage from '@/app/page';

const ACCOUNT_CTA = /create an account|log in|sign up/i;

describe('Landing page', () => {
  it('offers Log in and Sign up in the top bar', () => {
    render(<LandingPage />);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(within(header).getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
  });

  it('has no account buttons or links anywhere outside the top bar', () => {
    render(<LandingPage />);
    const main = screen.getByRole('main');
    const footer = screen.getByRole('contentinfo');

    for (const region of [main, footer]) {
      expect(region.textContent).not.toMatch(ACCOUNT_CTA);
      expect(region.querySelectorAll('a[href="/login"], a[href="/register"]')).toHaveLength(0);
      expect(within(region).queryAllByRole('link', { name: ACCOUNT_CTA })).toHaveLength(0);
      expect(within(region).queryAllByRole('button', { name: ACCOUNT_CTA })).toHaveLength(0);
    }
  });

  it('points every navigation link at a section on the page', () => {
    const { container } = render(<LandingPage />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const link of within(nav).getAllByRole('link')) {
      const id = link.getAttribute('href')!.slice(1);
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });
});
