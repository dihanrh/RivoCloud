import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeSamples, SNIPPETS } from './code-samples';

describe('CodeSamples', () => {
  it('copies the snippet for the active language and example', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<CodeSamples />);

    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenLastCalledWith(SNIPPETS.curl.create);
    expect(await screen.findByRole('button', { name: 'Copied to clipboard' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /JavaScript/ }));
    await user.click(screen.getByRole('button', { name: 'Purge the cache' }));
    expect(screen.getByTestId('code-sample')).toHaveTextContent('rivo.cache.invalidate');

    await user.click(screen.getByRole('button', { name: /Cop/ }));
    expect(writeText).toHaveBeenLastCalledWith(SNIPPETS.js.purge);
  });

  it('switches languages with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<CodeSamples />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tabs[2]).toHaveFocus();
    expect(screen.getByTestId('code-sample')).toHaveTextContent('rivo zones create');
  });
});
