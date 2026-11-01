'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False during SSR and the hydration render, true afterwards.
 *
 * The app shell starts queries such as /api/me, /api/zones and /api/buckets as soon as it
 * hydrates. On a fast server those answers can land before a streamed page segment hydrates,
 * and TanStack Query then hands the page cached data on its hydration render while the server
 * HTML was the loading state, which is a hydration mismatch (React error #418). Pages that read
 * shared queries render their skeleton until this returns true.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
