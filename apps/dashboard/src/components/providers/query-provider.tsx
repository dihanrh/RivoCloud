'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/http';

function handleQueryError(error: unknown) {
  if (!(error instanceof ApiError)) return;

  const pathname = window.location.pathname;

  if (error.status === 401 && pathname !== '/login') {
    window.location.href = '/login';
    return;
  }

  if (error.status === 409 && pathname !== '/orgs') {
    window.location.href = '/orgs';
  }
}

/**
 * Retry once, but never on a 4xx: retrying a 429 doubles the load that triggered it,
 * and other client errors will not succeed on a second attempt.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: shouldRetryQuery } },
        queryCache: new QueryCache({ onError: handleQueryError }),
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
