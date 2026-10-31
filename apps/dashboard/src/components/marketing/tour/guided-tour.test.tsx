import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import LandingPage from '@/app/page';
import { TOUR_STEPS } from './tour-steps';

const total = TOUR_STEPS.length;

function startTour() {
  render(<LandingPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Take a tour' }));
  return screen.getByRole('dialog');
}

function tab(name: RegExp) {
  return within(screen.getByRole('tablist', { name: 'Products' })).getByRole('tab', { name });
}

describe('Guided tour', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces the hero demo button with Take a tour', () => {
    render(<LandingPage />);
    const hero = screen.getByRole('region', { name: /your files and your traffic/i });
    expect(within(hero).getByRole('button', { name: 'Take a tour' })).toBeInTheDocument();
    expect(within(hero).queryByRole('button', { name: /request a demo/i })).toBeNull();
    expect(within(hero).queryByRole('link', { name: /request a demo/i })).toBeNull();
    expect(within(hero).getByRole('link', { name: /see how it works/i })).toHaveAttribute('href', '#how-it-works');
    expect(screen.getByRole('banner').textContent).not.toMatch(/request a demo|take a tour/i);
  });

  it('opens on step 1 and moves focus to the caption card', () => {
    const dialog = startTour();
    expect(dialog).toHaveAccessibleName(TOUR_STEPS[0].title);
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(dialog).toHaveTextContent(`Step 1 of ${total}`);
    expect(dialog).toHaveFocus();
    expect(screen.getByText(`Step 1 of ${total}: ${TOUR_STEPS[0].title}`)).toBeInTheDocument();
  });

  it('supports Next, Back and Esc, and returns focus to the tour button', () => {
    startTour();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[1].title);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[2].title);
    expect(tab(/Object storage/)).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[1].title);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[0].title);
    expect(screen.getByRole('button', { name: 'Previous step' })).toBeDisabled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Take a tour' })).toHaveFocus();
  });

  it('auto-advances and selects the next product tab', () => {
    vi.useFakeTimers();
    startTour();
    act(() => {
      vi.advanceTimersByTime(TOUR_STEPS[0].duration);
    });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Websites & caching');
    expect(tab(/Websites & caching/)).toHaveAttribute('aria-selected', 'true');

    act(() => {
      vi.advanceTimersByTime(TOUR_STEPS[1].duration);
    });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Object storage');
    expect(tab(/Object storage/)).toHaveAttribute('aria-selected', 'true');
  });

  it('toggles pause with Space and stops auto-advancing while paused', () => {
    vi.useFakeTimers();
    startTour();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Resume tour' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[0].title);

    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByRole('button', { name: 'Pause tour' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(TOUR_STEPS[0].duration);
    });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[1].title);
  });

  it('pauses while the pointer is over the caption card', () => {
    vi.useFakeTimers();
    const dialog = startTour();
    fireEvent.mouseMove(dialog);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[0].title);
    fireEvent.mouseLeave(dialog);
    act(() => {
      vi.advanceTimersByTime(TOUR_STEPS[0].duration);
    });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[1].title);
  });

  it('ends on a finish card with Replay tour and Back to top, and no account links', () => {
    startTour();
    for (let i = 0; i < total; i += 1) fireEvent.keyDown(window, { key: 'ArrowRight' });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('That’s RivoCloud');
    expect(within(dialog).getByRole('button', { name: 'Replay tour' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Back to top' })).toBeInTheDocument();
    expect(within(dialog).queryAllByRole('link')).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Replay tour' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(TOUR_STEPS[0].title);
  });
});
