'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { AuditLogPage } from '@/lib/types';

const PAGE_SIZE = 50;

export function useAuditLogs(orgId: string) {
  return useInfiniteQuery({
    queryKey: ['audit-logs', orgId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<AuditLogPage>(`/api/orgs/${orgId}/audit-logs?${params.toString()}`);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
