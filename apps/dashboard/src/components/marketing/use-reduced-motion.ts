'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener?.('change', onChange);
  return () => mql.removeEventListener?.('change', onChange);
}

function getSnapshot() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(QUERY).matches;
}

/**
 * True when the visitor asked for reduced motion. Defaults to true on the
 * server and in environments without matchMedia, so nothing animates until we
 * know it is welcome.
 */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
