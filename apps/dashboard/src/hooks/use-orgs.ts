'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { Organization } from '@/lib/types';

export function useOrgs() {
  return useQuery({
    queryKey: ['orgs'],
    queryFn: () => apiFetch<Organization[]>('/api/orgs'),
  });
}
