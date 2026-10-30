'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAddMember, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/use-members';
import { canChangeRoles, canManageMembers } from '@/lib/rbac';
import { errorMessage } from '@/lib/http';
import type { OrgMember, OrgRole } from '@/lib/types';

const SELECT_CLASS = 'h-9 rounded-md border border-input bg-transparent px-3 text-sm';

type InviteRole = Exclude<OrgRole, 'owner'>;

function inviteRolesFor(role: string | null): InviteRole[] {
  return role === 'owner' ? ['admin', 'developer', 'viewer'] : ['developer', 'viewer'];
}

// Owners can remove anyone but another owner; admins only developers/viewers.
function canRemove(role: string | null, target: OrgMember): boolean {
  if (target.role === 'owner') return false;
  if (role === 'owner') return true;
  return role === 'admin' && (target.role === 'developer' || target.role === 'viewer');
}

export function MembersPanel({ orgId, role }: { orgId: string; role: string | null }) {
  const { data: members, isLoading, error } = useMembers(orgId);
  const addMember = useAddMember(orgId);
  const updateRole = useUpdateMemberRole(orgId);
  const removeMember = useRemoveMember(orgId);

  const inviteRoles = inviteRolesFor(role);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('developer');
  const [message, setMessage] = useState<string | null>(null);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await addMember.mutateAsync({ email, role: inviteRole });
      setEmail('');
    } catch (err) {
      setMessage(errorMessage(err, 'Could not add member'));
    }
  }

  async function handleRoleChange(userId: string, newRole: OrgRole) {
    setMessage(null);
    try {
      await updateRole.mutateAsync({ userId, role: newRole });
    } catch (err) {
      setMessage(errorMessage(err, 'Could not change role'));
    }
  }

  async function handleRemove(userId: string) {
    setMessage(null);
    try {
      await removeMember.mutateAsync(userId);
    } catch (err) {
      setMessage(errorMessage(err, 'Could not remove member'));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canManageMembers(role) && (
        <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              className={SELECT_CLASS}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as InviteRole)}
            >
              {inviteRoles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={addMember.isPending}>
            {addMember.isPending ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
      )}
      {message && <p className="text-sm text-destructive">{message}</p>}
      {isLoading && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-destructive">Failed to load members.</p>}
      {members && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell>{member.user.name}</TableCell>
                <TableCell>{member.user.email}</TableCell>
                <TableCell>
                  {canChangeRoles(role) && member.role !== 'owner' ? (
                    <select
                      aria-label={`Role for ${member.user.email}`}
                      className={SELECT_CLASS}
                      value={member.role}
                      disabled={updateRole.isPending}
                      onChange={(e) => void handleRoleChange(member.userId, e.target.value as OrgRole)}
                    >
                      {(['admin', 'developer', 'viewer'] as const).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    member.role
                  )}
                </TableCell>
                <TableCell>{member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '—'}</TableCell>
                <TableCell className="text-right">
                  {canRemove(role, member) && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Remove ${member.user.email}`}
                      disabled={removeMember.isPending}
                      onClick={() => void handleRemove(member.userId)}
                    >
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
