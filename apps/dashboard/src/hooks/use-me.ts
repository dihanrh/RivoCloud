'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { OrgRole, UserProfile } from '@/lib/types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<UserProfile & { orgId: string | null; role: OrgRole | null }>('/api/me'),
  });
}
