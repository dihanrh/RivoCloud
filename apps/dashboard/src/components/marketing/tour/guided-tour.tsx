'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, ChevronLeft, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '../use-reduced-motion';
import { TAKE_TOUR_BUTTON_ID } from './take-tour-button';
import { useTourCommand } from './tour-bus';
import { TOUR_STEPS, type TourStep } from './tour-steps';

/** Height of the sticky marketing header. */
const HEADER = 72;
/** Space between the spotlight ring and the element it highlights. */
const PAD = 10;
const CARD_W = 380;
const EDGE = 16;
const TICK = 100;
const MOBILE_MAX = 640;

type Rect = { top: number; left: number; width: number; height: number };
type Focus = { selector: string; index: number } | null;

function targetsFor(step: TourStep, focus: Focus): HTMLElement[] {
  if (focus) {
    const el = document.querySelectorAll<HTMLElement>(focus.selector)[focus.index];
    if (el) return [el];
  }
  return step.target.map((selector) => document.querySelector<HTMLElement>(selector)).filter((el): el is HTMLElement => !!el);
}

function unionRect(elements: HTMLElement[]): Rect | null {
  if (elements.length === 0) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return { top, left, width: right - left, height: bottom - top };
}

function sameRect(a: Rect | null, b: Rect | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Where to float the caption card on wide screens: beside, below or above the target. */
function placeCard(rect: Rect, vw: number, vh: number, cardH: number) {
  const gap = PAD + 14;
  const minTop = HEADER + EDGE;
  const maxTop = Math.max(minTop, vh - cardH - EDGE);
  const besideTop = clamp(rect.top, minTop, maxTop);
  if (rect.left + rect.width + gap + CARD_W <= vw - EDGE) {
    return { top: besideTop, left: rect.left + rect.width + gap };
  }
  if (rect.left - gap - CARD_W >= EDGE) {
    return { top: besideTop, left: rect.left - gap - CARD_W };
  }
  const alignedLeft = clamp(rect.left + rect.width - CARD_W, EDGE, vw - CARD_W - EDGE);
  if (rect.top + rect.height + gap + cardH <= vh - EDGE) {
    return { top: rect.top + rect.height + gap, left: alignedLeft };
  }
  if (rect.top - gap - cardH >= minTop) {
    return { top: rect.top - gap - cardH, left: alignedLeft };
  }
  return { top: vh - cardH - 24, left: vw - CARD_W - 24 };
}

function isEditable(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * A guided, auto-playing walkthrough of the home page. It scrolls to each
 * section, spotlights it, drives the interactive demos through the tour
 * command bus and explains what you are looking at in a floating caption.
 */
export function GuidedTour() {
  const steps = TOUR_STEPS;
  const total = steps.length;
  const reduced = useReducedMotion();
  const baseId = useId();

  /** null while idle, 0..total-1 for a step, total for the finish card. */
  const [index, setIndex] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [label, setLabel] = useState<string | undefined>();
  const [focus, setFocus] = useState<Focus>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ w: 1280, h: 800, cardH: 220 });

  const elapsedRef = useRef(0);
  const firedRef = useRef(new Set<number>());
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reducedRef = useRef(reduced);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  const active = index !== null;
  const finished = index === total;
  const step = index !== null && index < total ? steps[index] : null;
  const paused = userPaused || hovered || hidden;
  const mobile = viewport.w <= MOBILE_MAX;

  const fireDue = useCallback((target: TourStep, upTo: number) => {
    target.actions?.forEach((action, i) => {
      if (firedRef.current.has(i) || action.at > upTo) return;
      firedRef.current.add(i);
      action.run();
      if (action.label) setLabel(action.label);
      if (action.target) setFocus({ selector: action.target, index: action.targetIndex ?? 0 });
    });
  }, []);

  const goTo = useCallback(
    (next: number) => {
      const clamped = clamp(next, 0, total);
      elapsedRef.current = 0;
      firedRef.current = new Set();
      setElapsed(0);
      setLabel(undefined);
      setFocus(null);
      setIndex(clamped);
      if (clamped < total) fireDue(steps[clamped], 0);
    },
    [fireDue, steps, total],
  );

  const start = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    setUserPaused(false);
    setHovered(false);
    setViewport((v) => ({ ...v, w: window.innerWidth, h: window.innerHeight }));
    goTo(0);
  }, [goTo]);

  const exit = useCallback(() => {
    setIndex(null);
    setRect(null);
    setHovered(false);
    setUserPaused(false);
    const button = document.getElementById(TAKE_TOUR_BUTTON_ID) ?? openerRef.current;
    button?.focus({ preventScroll: true });
  }, []);

  const backToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: reducedRef.current ? 'instant' : 'smooth' });
    exit();
  }, [exit]);

  useTourCommand('start', start);

  // Deep link: /?tour=1 starts the tour once the page has settled.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tour') !== '1') return;
    const id = window.setTimeout(() => start(), 500);
    return () => window.clearTimeout(id);
  }, [start]);

  // Auto-advance, firing each step's timed actions along the way.
  useEffect(() => {
    if (!step || index === null || paused) return;
    const id = window.setInterval(() => {
      elapsedRef.current += TICK;
      fireDue(step, elapsedRef.current);
      if (elapsedRef.current >= step.duration) goTo(index + 1);
      else setElapsed(elapsedRef.current);
    }, TICK);
    return () => window.clearInterval(id);
  }, [step, index, paused, fireDue, goTo]);

  // Pause while the browser tab is hidden.
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active]);

  // Keyboard: Space pause/play, arrows back/next, Esc exit.
  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        exit();
        return;
      }
      if (isEditable(event.target)) return;
      const inCard = event.target instanceof Node && !!cardRef.current?.contains(event.target);
      const inWidget =
        !inCard && event.target instanceof HTMLElement && !!event.target.closest('[role="tablist"], [role="radiogroup"]');
      if (event.key === ' ' || event.key === 'Spacebar') {
        if (index >= total) return;
        event.preventDefault();
        setUserPaused((value) => !value);
      } else if (event.key === 'ArrowRight' && !inWidget) {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === 'ArrowLeft' && !inWidget) {
        event.preventDefault();
        goTo(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, total, exit, goTo]);

  // Move focus to the card when the tour opens, and again on the finish card.
  useEffect(() => {
    if (active && !wasActiveRef.current) cardRef.current?.focus({ preventScroll: true });
    wasActiveRef.current = active;
  }, [active]);
  useEffect(() => {
    if (finished) cardRef.current?.focus({ preventScroll: true });
  }, [finished]);

  // Bring the current target into view, below the header and above a docked card.
  useEffect(() => {
    if (!step) return;
    const rectNow = unionRect(targetsFor(step, focus));
    if (!rectNow) return;
    const vw = window.innerWidth;
    const isMobile = vw <= MOBILE_MAX;
    const cardH = cardRef.current?.offsetHeight || 260;
    const top = HEADER + EDGE;
    let reserved = isMobile ? cardH + 24 : EDGE;
    // On wide screens, when the card cannot sit beside the target, leave room
    // for it underneath if both fit on screen together.
    const gap = PAD + 14;
    const noSideRoom =
      rectNow.left + rectNow.width + gap + CARD_W > vw - EDGE && rectNow.left - gap - CARD_W < EDGE;
    if (!isMobile && noSideRoom && rectNow.height + gap + cardH <= window.innerHeight - top - EDGE) {
      reserved = EDGE + cardH + gap;
    }
    const avail = window.innerHeight - reserved - top;
    let y = rectNow.top + window.scrollY - top;
    if (rectNow.height < avail) y -= (avail - rectNow.height) / 2;
    try {
      window.scrollTo({ top: Math.max(0, y), behavior: reducedRef.current ? 'instant' : 'smooth' });
    } catch {
      // Older browsers and test environments without scrollTo.
    }
  }, [step, focus]);

  // Keep the spotlight glued to the target while the page scrolls or resizes.
  useEffect(() => {
    if (!step) return;
    const raf = window.requestAnimationFrame?.bind(window) ?? ((cb: FrameRequestCallback) => window.setTimeout(cb, 16));
    const caf = window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = unionRect(targetsFor(step, focus));
      setRect((prev) => (sameRect(prev, next) ? prev : next));
      const cardH = cardRef.current?.offsetHeight || 220;
      setViewport((v) =>
        v.w === window.innerWidth && v.h === window.innerHeight && v.cardH === cardH
          ? v
          : { w: window.innerWidth, h: window.innerHeight, cardH },
      );
    };
    const schedule = () => {
      if (!frame) frame = raf(measure) as unknown as number;
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    for (const el of targetsFor(step, focus)) observer?.observe(el);
    if (cardRef.current) observer?.observe(cardRef.current);
    return () => {
      if (frame) caf(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [step, focus]);

  const announcement = !active
    ? ''
    : finished
      ? 'Tour complete. That’s RivoCloud.'
      : `Step ${index + 1} of ${total}: ${step?.title}${userPaused ? '. Paused' : ''}`;

  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const progress = step ? Math.min(100, (elapsed / step.duration) * 100) : 0;
  const position = step && rect && !mobile ? placeCard(rect, viewport.w, viewport.h, viewport.cardH) : null;
  const motion = !reduced;

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {active && (
        <>
          {step && rect ? (
            <div
              aria-hidden
              data-testid="tour-spotlight"
              className={cn('mk-tour-spotlight', motion && 'mk-tour-spotlight-motion')}
              style={{
                top: rect.top - PAD,
                left: rect.left - PAD,
                width: rect.width + PAD * 2,
                height: rect.height + PAD * 2,
              }}
            >
              {motion && <span className="mk-tour-ring" />}
            </div>
          ) : (
            <div aria-hidden className="mk-tour-scrim" />
          )}

          <div
            ref={cardRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            tabIndex={-1}
            onMouseMove={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            data-placement={finished ? 'center' : mobile || !position ? 'dock' : 'float'}
            className={cn(
              'mk-tour-card fixed z-[70] overflow-hidden rounded-2xl border border-border bg-background text-left text-foreground shadow-[0_24px_64px_-16px_rgba(15,17,21,0.45),0_2px_6px_rgba(15,17,21,0.08)] outline-none focus-visible:outline-none',
              finished
                ? 'inset-x-4 top-1/2 mx-auto max-w-[440px] -translate-y-1/2'
                : mobile || !position
                  ? 'inset-x-3 bottom-3 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[380px]'
                  : 'w-[380px]',
              motion && 'mk-tour-card-motion',
            )}
            style={position ? { top: position.top, left: position.left } : undefined}
          >
            {finished ? (
              <FinishCard
                titleId={titleId}
                bodyId={bodyId}
                onReplay={() => goTo(0)}
                onTop={backToTop}
                onExit={exit}
              />
            ) : step ? (
              <>
                <div className="h-[3px] w-full bg-muted" aria-hidden>
                  <div
                    className="h-full rounded-r-full"
                    style={{
                      width: `${progress}%`,
                      background: 'var(--brand-gradient)',
                      transition: motion && elapsed > 0 ? `width ${TICK}ms linear` : 'none',
                    }}
                    data-testid="tour-timer"
                  />
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2">
                    <p className="text-[12px] font-semibold tracking-wide text-primary">
                      Step {index + 1} of {total}
                    </p>
                    {paused && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Paused
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={exit}
                      aria-label="Exit tour"
                      className="-mr-1.5 ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <h2 id={titleId} className="mt-1 text-[18px] font-semibold leading-snug tracking-tight">
                    {step.title}
                  </h2>
                  <p id={bodyId} className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                  {label && (
                    <p
                      key={label}
                      className={cn(
                        'mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[12px] font-medium text-primary',
                        motion && 'mk-fade-up',
                      )}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      <span className="truncate">{label}</span>
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-3">
                    <ol className="flex min-w-0 flex-1 items-center gap-1" aria-hidden>
                      {steps.map((s, i) => (
                        <li
                          key={s.id}
                          className={cn(
                            'h-1.5 rounded-full transition-all',
                            i === index ? 'w-4 bg-primary' : i < index ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-border',
                          )}
                        />
                      ))}
                    </ol>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Previous step"
                        disabled={index === 0}
                        onClick={() => goTo(index - 1)}
                      >
                        <ChevronLeft aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        aria-label={userPaused ? 'Resume tour' : 'Pause tour'}
                        onClick={() => setUserPaused((value) => !value)}
                      >
                        {userPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
                      </Button>
                      <Button type="button" onClick={() => goTo(index + 1)} rightIcon={<ArrowRight aria-hidden />}>
                        {index === total - 1 ? 'Finish' : 'Next'}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3.5 hidden items-center gap-1.5 border-t border-border pt-3 text-[11.5px] text-muted-foreground sm:flex">
                    <kbd className="mk-kbd">Space</kbd> pause
                    <span aria-hidden>·</span>
                    <kbd className="mk-kbd">←</kbd>
                    <kbd className="mk-kbd">→</kbd> move
                    <span aria-hidden>·</span>
                    <kbd className="mk-kbd">Esc</kbd> exit
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

function FinishCard({
  titleId,
  bodyId,
  onReplay,
  onTop,
  onExit,
}: {
  titleId: string;
  bodyId: string;
  onReplay: () => void;
  onTop: () => void;
  onExit: () => void;
}) {
  return (
    <div className="relative">
      <div className="h-1.5 w-full" style={{ background: 'var(--brand-gradient)' }} aria-hidden />
      <button
        type="button"
        onClick={onExit}
        aria-label="Exit tour"
        className="absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
      <div className="p-7 text-center">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-[0_10px_24px_-10px_rgba(214,36,106,0.7)]"
          style={{ background: 'var(--brand-gradient)' }}
          aria-hidden
        >
          <Sparkles className="h-6 w-6" />
        </span>
        <p className="mt-4 text-[12px] font-semibold tracking-wide text-primary">Tour complete</p>
        <h2 id={titleId} className="mt-1 text-[24px] font-semibold tracking-tight">
          That’s RivoCloud
        </h2>
        <p id={bodyId} className="mx-auto mt-2 max-w-[340px] text-[14.5px] leading-relaxed text-muted-foreground">
          Caching, storage, signed links, analytics, domains and teams, all in one console with one API.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" size="lg" onClick={onReplay} leftIcon={<RotateCcw aria-hidden />}>
            Replay tour
          </Button>
          <Button type="button" size="lg" variant="secondary" onClick={onTop} leftIcon={<ArrowUp aria-hidden />}>
            Back to top
          </Button>
        </div>
      </div>
    </div>
  );
}
