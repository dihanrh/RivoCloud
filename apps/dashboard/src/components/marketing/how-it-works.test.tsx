import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HowItWorks, STEPS } from './how-it-works';

describe('HowItWorks', () => {
  it('updates the diagram when a step is selected', async () => {
    const user = userEvent.setup();
    render(<HowItWorks />);
    expect(screen.getByRole('img', { name: new RegExp(STEPS[0].title) })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: new RegExp(STEPS[2].title) }));
    expect(screen.getByRole('tab', { name: new RegExp(STEPS[2].title) })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: new RegExp(STEPS[2].title) })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: new RegExp(STEPS[3].title) })).toHaveFocus();
    expect(screen.getByText(STEPS[3].detail)).toBeInTheDocument();
  });
});
