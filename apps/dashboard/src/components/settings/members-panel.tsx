'use client';

import { useMemo, useState } from 'react';
import { Copy, UserMinus, UserPlus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, RowActionsMenu, TableToolbar, type DataTableColumn } from '@/components/ui/data-table';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MenuItem, MenuSeparator } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { RelativeTime } from '@/components/ui/relative-time';
import { useToast } from '@/components/ui/toast';
import { ReadOnlyNote } from '@/components/storage/read-only-note';
import { useAddMember, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/use-members';
import { useQuickActionParam } from '@/hooks/use-quick-action-param';
import { errorMessage } from '@/lib/http';
import { canChangeRoles, canManageMembers } from '@/lib/rbac';
import type { OrgMember, OrgRole } from '@/lib/types';
import { UserAvatar } from './user-avatar';

type InviteRole = Exclude<OrgRole, 'owner'>;

export const ROLE_NAME: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', developer: 'Developer', viewer: 'Viewer' };

const ROLE_HINT: Record<InviteRole, string> = {
  admin: 'Manages members, websites, storage and keys.',
  developer: 'Changes websites, storage and their own API keys.',
  viewer: 'Read-only access to websites, storage and analytics.',
};

function inviteRolesFor(role: string | null): InviteRole[] {
  return role === 'owner' ? ['admin', 'developer', 'viewer'] : ['developer', 'viewer'];
}

// Owners can remove anyone but another owner; admins only developers/viewers.
function canRemove(role: string | null, target: OrgMember): boolean {
  if (target.role === 'owner') return false;
  if (role === 'owner') return true;
  return role === 'admin' && (target.role === 'developer' || target.role === 'viewer');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InviteMemberDialog({
  orgId,
  role,
  open,
  onOpenChange,
}: {
  orgId: string;
  role: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const addMember = useAddMember(orgId);
  const roles = inviteRolesFor(role);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('developer');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = addMember.isPending;

  function reset() {
    setEmail('');
    setInviteRole('developer');
    setEmailError(null);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setEmailError(value ? 'Enter a valid email address.' : 'Enter an email address.');
      return;
    }
    setEmailError(null);
    try {
      await addMember.mutateAsync({ email: value, role: inviteRole });
      toast.success('Member invited', `${value} joined as ${ROLE_NAME[inviteRole].toLowerCase()}.`);
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not invite the member. Check the email and try again.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm" preventClose={pending}>
        <DialogForm onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>The person needs a RivoCloud account with this email.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Email" error={emailError} required>
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                placeholder="teammate@example.com"
                autoComplete="off"
                autoFocus
              />
            </Field>
            <Field label="Role" hint={ROLE_HINT[inviteRole]}>
              <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as InviteRole)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAME[r]}
                  </option>
                ))}
              </Select>
            </Field>
            {error && (
              <div role="alert" className="rounded-[var(--radius)] border border-destructive/40 bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              Invite member
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

export function MembersPanel({ orgId, role, meId }: { orgId: string; role: string | null; meId?: string }) {
  const toast = useToast();
  const { data: members, isLoading, error, refetch } = useMembers(orgId);
  const updateRole = useUpdateMemberRole(orgId);
  const removeMember = useRemoveMember(orgId);
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<OrgMember | null>(null);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);

  const canManage = canManageMembers(role);
  useQuickActionParam('invite', () => setInviteOpen(true), canManage);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members ?? []).filter((m) => !q || m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q));
  }, [members, search]);

  async function handleRoleChange(member: OrgMember, newRole: OrgRole) {
    setSavingRoleFor(member.userId);
    try {
      await updateRole.mutateAsync({ userId: member.userId, role: newRole });
      toast.success('Role updated', `${member.user.email} is now ${ROLE_NAME[newRole].toLowerCase()}.`);
    } catch (err) {
      toast.error('Could not update the role', errorMessage(err, 'Try again.'));
    } finally {
      setSavingRoleFor(null);
    }
  }

  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      toast.success('Email copied', email);
    } catch {
      toast.error('Could not copy', 'Select the email and copy it manually.');
    }
  }

  const columns: DataTableColumn<OrgMember>[] = [
    {
      id: 'member',
      header: 'Member',
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar name={m.user.name} email={m.user.email} className="hidden sm:flex" />
          <div className="flex min-w-0 max-w-[8.5rem] flex-col sm:max-w-none">
            <span className="flex items-center gap-1.5 truncate font-medium">
              {m.user.name || m.user.email}
              {meId && m.userId === meId && <Badge variant="outline">You</Badge>}
            </span>
            <span className="truncate text-xs text-muted-foreground">{m.user.email}</span>
          </div>
        </div>
      ),
      className: 'pr-2 sm:pr-4',
    },
    {
      id: 'role',
      header: 'Role',
      cell: (m) =>
        canChangeRoles(role) && m.role !== 'owner' ? (
          <Select
            aria-label={`Role for ${m.user.email}`}
            className="h-8 w-[6.5rem] text-[13px] sm:w-36"
            value={m.role}
            disabled={savingRoleFor === m.userId}
            aria-busy={savingRoleFor === m.userId || undefined}
            onChange={(e) => void handleRoleChange(m, e.target.value as OrgRole)}
          >
            {(['admin', 'developer', 'viewer'] as const).map((r) => (
              <option key={r} value={r}>
                {ROLE_NAME[r]}
              </option>
            ))}
          </Select>
        ) : (
          <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>{ROLE_NAME[m.role] ?? m.role}</Badge>
        ),
    },
    {
      id: 'joined',
      header: 'Joined',
      cell: (m) => <RelativeTime value={m.joinedAt} className="text-muted-foreground" />,
      align: 'right',
      hideBelow: 'sm',
    },
  ];

  return (
    <div className="flex flex-col">
      {!canManage && <ReadOnlyNote>Only account owners and admins can invite, remove or change members.</ReadOnlyNote>}
      <DataTable
        aria-label="Members"
        columns={columns}
        rows={filtered}
        getRowKey={(m) => m.userId}
        loading={isLoading}
        error={error ? 'Could not load members.' : null}
        onRetry={() => void refetch()}
        toolbar={
          <TableToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search members"
            count={members ? filtered.length : undefined}
            noun="member"
            actions={
              canManage ? (
                <Button leftIcon={<UserPlus />} onClick={() => setInviteOpen(true)}>
                  Invite member
                </Button>
              ) : undefined
            }
          />
        }
        empty={<EmptyState icon={Users} title="No members yet" description="Invite teammates to work in this account." />}
        emptyFiltered={search.trim() ? <EmptyState title="No matching members" description="Try a different name or email." /> : undefined}
        rowActions={(m) => (
          <RowActionsMenu label={`Actions for ${m.user.email}`}>
            <MenuItem icon={<Copy />} onSelect={() => void copyEmail(m.user.email)}>
              Copy email
            </MenuItem>
            {canRemove(role, m) && (
              <>
                <MenuSeparator />
                <MenuItem icon={<UserMinus />} tone="destructive" onSelectAfterClose={() => setRemoving(m)}>
                  Remove member…
                </MenuItem>
              </>
            )}
          </RowActionsMenu>
        )}
      />
      {canManage && <InviteMemberDialog orgId={orgId} role={role} open={inviteOpen} onOpenChange={setInviteOpen} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        tone="destructive"
        title="Remove member"
        description={
          <>
            <span className="font-semibold text-foreground">{removing?.user.email}</span> loses access to this account straight away.
            You can invite them again later.
          </>
        }
        confirmLabel="Remove member"
        successToast={{ title: 'Member removed', description: removing?.user.email }}
        errorFallback="Could not remove the member. Try again."
        onConfirm={async () => {
          if (removing) await removeMember.mutateAsync(removing.userId);
        }}
      />
    </div>
  );
}
