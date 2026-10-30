'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAddMember, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/use-members';
import { canChangeRoles, canManageMembers } from '@/lib/rbac';
import { errorMessage } from '@/lib/http';
import type { OrgMember, OrgRole } from '@/lib/types';

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
      setMessage(errorMessage(err, 'Could not invite the member. Check the email and try again.'));
    }
  }

  async function handleRoleChange(userId: string, newRole: OrgRole) {
    setMessage(null);
    try {
      await updateRole.mutateAsync({ userId, role: newRole });
    } catch (err) {
      setMessage(errorMessage(err, 'Could not change the role. Try again.'));
    }
  }

  async function handleRemove(userId: string) {
    setMessage(null);
    try {
      await removeMember.mutateAsync(userId);
    } catch (err) {
      setMessage(errorMessage(err, 'Could not remove the member. Try again.'));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canManageMembers(role) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Invite a member</CardTitle>
            <CardDescription>The person needs a RivoCloud account with this email.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-56 flex-1 flex-col gap-1.5">
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
                <Select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as InviteRole)}>
                  {inviteRoles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" disabled={addMember.isPending}>
                {addMember.isPending ? 'Inviting…' : 'Invite member'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {message && <ErrorBanner>{message}</ErrorBanner>}
      {isLoading && <Skeleton className="h-32 w-full" />}
      {error && <ErrorBanner>Could not load members. Refresh the page to try again.</ErrorBanner>}
      {members && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">{member.user.name}</TableCell>
                  <TableCell>{member.user.email}</TableCell>
                  <TableCell>
                    {canChangeRoles(role) && member.role !== 'owner' ? (
                      <Select
                        aria-label={`Role for ${member.user.email}`}
                        className="h-8 w-auto text-[13px]"
                        value={member.role}
                        disabled={updateRole.isPending}
                        onChange={(e) => void handleRoleChange(member.userId, e.target.value as OrgRole)}
                      >
                        {(['admin', 'developer', 'viewer'] as const).map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>{member.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {canRemove(role, member) && (
                        <Button
                          variant="destructive-outline"
                          size="sm"
                          aria-label={`Remove ${member.user.email}`}
                          disabled={removeMember.isPending}
                          onClick={() => void handleRemove(member.userId)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
