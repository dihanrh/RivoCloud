'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Runs `onTrigger` when the URL carries `?<param>=1` (the command palette's quick actions,
 * e.g. /storage?create=1), then strips the param so a refresh or Back doesn't reopen it.
 *
 *   useQuickActionParam('create', () => setCreateOpen(true));
 */
export function useQuickActionParam(param: string, onTrigger: () => void, enabled = true) {
  // Null outside the app router (unit tests that don't mock next/navigation).
  const searchParams = useSearchParams() as URLSearchParams | null;
  const value = searchParams?.get(param) ?? null;
  const triggerRef = useRef(onTrigger);
  triggerRef.current = onTrigger;

  useEffect(() => {
    if (!enabled || value !== '1') return;
    triggerRef.current();
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    // Next's router picks up native history updates, so useSearchParams sees the param go away.
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [param, value, enabled]);
}
