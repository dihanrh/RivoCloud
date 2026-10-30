import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeatureTabs, FEATURES } from './feature-tabs';

describe('FeatureTabs', () => {
  it('shows the first product and switches panels on click', async () => {
    const user = userEvent.setup();
    render(<FeatureTabs />);
    expect(screen.getByRole('tab', { name: /Websites & caching/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(FEATURES[0].title);

    await user.click(screen.getByRole('tab', { name: /Object storage/ }));
    expect(screen.getByRole('tab', { name: /Object storage/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(FEATURES[1].title);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Object storage/);
  });

  it('supports arrow keys, Home and End with roving focus', async () => {
    const user = userEvent.setup();
    render(<FeatureTabs />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');

    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{End}');
    expect(tabs[tabs.length - 1]).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent(FEATURES[FEATURES.length - 1].title);

    await user.keyboard('{ArrowRight}');
    expect(tabs[0]).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(tabs[tabs.length - 1]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });
});
