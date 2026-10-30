import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pricing } from './pricing';

describe('Pricing', () => {
  it('switches between monthly and yearly prices', async () => {
    const user = userEvent.setup();
    render(<Pricing />);
    expect(screen.getByRole('radio', { name: 'Monthly' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('price-Free')).toHaveTextContent('$0');
    expect(screen.getByTestId('price-Pro')).toHaveTextContent('$25');
    expect(screen.getByTestId('price-Business')).toHaveTextContent('$199');

    await user.click(screen.getByRole('radio', { name: /Yearly/ }));
    expect(screen.getByRole('radio', { name: /Yearly/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('price-Free')).toHaveTextContent('$0');
    expect(screen.getByTestId('price-Pro')).toHaveTextContent('$20');
    expect(screen.getByTestId('price-Business')).toHaveTextContent('$159');
    expect(screen.getByText('Billed $240 a year')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Monthly' }));
    expect(screen.getByTestId('price-Pro')).toHaveTextContent('$25');
  });

  it('opens a contact dialog with the plan preselected instead of an account flow', async () => {
    const user = userEvent.setup();
    render(<Pricing />);
    await user.click(screen.getByRole('button', { name: 'Choose Business' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Get started on Business' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Plan you are interested in')).toHaveValue('Business');

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Talk to sales' }));
    expect(await screen.findByRole('heading', { name: 'Talk to our sales team' })).toBeInTheDocument();
  });
});
