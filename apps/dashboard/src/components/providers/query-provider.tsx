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

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1 } },
        queryCache: new QueryCache({ onError: handleQueryError }),
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
