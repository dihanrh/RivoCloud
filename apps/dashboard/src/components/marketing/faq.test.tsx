import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Faq, FAQS } from './faq';

describe('Faq', () => {
  it('opens the first answer by default', () => {
    render(<Faq />);
    expect(screen.getByRole('button', { name: FAQS[0].q })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: FAQS[0].q })).toBeVisible();
  });

  it('expands and collapses an answer', async () => {
    const user = userEvent.setup();
    render(<Faq />);
    const question = screen.getByRole('button', { name: FAQS[1].q });
    expect(question).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: FAQS[1].q })).not.toBeInTheDocument();

    await user.click(question);
    expect(question).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: FAQS[1].q })).toHaveTextContent(/message bus/);
    // Opening one question closes the previous one.
    expect(screen.getByRole('button', { name: FAQS[0].q })).toHaveAttribute('aria-expanded', 'false');

    await user.click(question);
    expect(question).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: FAQS[1].q })).not.toBeInTheDocument();
  });

  it('is keyboard operable', async () => {
    const user = userEvent.setup();
    render(<Faq />);
    const question = screen.getByRole('button', { name: FAQS[2].q });
    question.focus();
    await user.keyboard('{Enter}');
    expect(question).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(question).toHaveAttribute('aria-expanded', 'false');
  });
});
