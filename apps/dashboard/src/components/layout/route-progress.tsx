'use client';

/**
 * RouteProgress — a thin brand-gradient bar at the very top while a client navigation
 * is in flight. No dependencies: it starts on same-origin <a> clicks that change the
 * pathname (and on `startRouteProgress(href)` for programmatic router.push), and finishes
 * when usePathname() changes. Quick navigations (< 120 ms) never show it. A safety timeout
 * hides it after 12 s.
 *
 *   import { startRouteProgress } from '@/components/layout/route-progress';
 *   startRouteProgress('/zones'); router.push('/zones');
 */
import * as React from 'react';
import { usePathname } from 'next/navigation';

const START_EVENT = 'rc:route-progress-start';

/** Call before a programmatic navigation so the bar shows. No-op if the pathname is unchanged. */
export function startRouteProgress(href: string) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
  } catch {
    return;
  }
  window.dispatchEvent(new Event(START_EVENT));
}

export function RouteProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = React.useState(0); // 0..1
  const [visible, setVisible] = React.useState(false);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const running = React.useRef(false);

  const clearTimers = React.useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const done = React.useCallback(() => {
    if (!running.current) return;
    running.current = false;
    clearTimers();
    setProgress(1);
    timers.current.push(setTimeout(() => setVisible(false), 220));
    timers.current.push(setTimeout(() => setProgress(0), 520));
  }, [clearTimers]);

  const start = React.useCallback(() => {
    if (running.current) return;
    running.current = true;
    clearTimers();
    setProgress(0);
    // Delay showing so instant (cached) navigations don't flash a bar.
    timers.current.push(
      setTimeout(() => {
        setVisible(true);
        setProgress(0.25);
      }, 120),
    );
    // Trickle towards 90%.
    [400, 900, 1600, 2600, 4000].forEach((ms, i) => {
      timers.current.push(setTimeout(() => setProgress((p) => Math.max(p, [0.45, 0.6, 0.72, 0.82, 0.9][i])), ms));
    });
    timers.current.push(setTimeout(() => done(), 12000));
  }, [done, clearTimers]);

  // Finish when the route changes.
  React.useEffect(() => {
    done();
  }, [pathname, done]);

  React.useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor || !anchor.href || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      start();
    }
    const onStart = () => start();
    document.addEventListener('click', onClick);
    window.addEventListener(START_EVENT, onStart);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener(START_EVENT, onStart);
      clearTimers();
    };
  }, [start, clearTimers]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[2.5px]">
      <div
        className="rc-route-progress h-full w-full"
        style={{ transform: `scaleX(${progress})`, opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
