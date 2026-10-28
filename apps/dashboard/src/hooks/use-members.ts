'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { OrgMember, OrgRole } from '@/lib/types';

export function useMembers(orgId: string) {
  return useQuery({
    queryKey: ['members', orgId],
    queryFn: () => apiFetch<OrgMember[]>(`/api/orgs/${orgId}/members`),
  });
}

export function useAddMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: Exclude<OrgRole, 'owner'> }) =>
      apiFetch<unknown>(`/api/orgs/${orgId}/members`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
    },
  });
}

export function useUpdateMemberRole(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      apiFetch<unknown>(`/api/orgs/${orgId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
    },
  });
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiFetch<unknown>(`/api/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
    },
  });
}
