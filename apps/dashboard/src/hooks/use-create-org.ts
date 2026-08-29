'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CreateOrgInput } from '@/lib/validation';
import type { Organization } from '@/lib/types';

export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrgInput) =>
      apiFetch<{ organization: Organization }>('/api/orgs', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orgs'] });
    },
  });
}
