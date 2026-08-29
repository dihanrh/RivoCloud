'use client';

import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useSelectOrg() {
  return useMutation({
    mutationFn: (orgId: string) => apiFetch<{ org: string }>('/api/orgs/select', { method: 'POST', body: JSON.stringify({ orgId }) }),
  });
}
