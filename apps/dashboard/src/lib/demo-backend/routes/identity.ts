import {
  assertValid,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from '../http';
import {
  iso,
  isBool,
  isEmail,
  isString,
  liveRole,
  membership,
  optional,
  recordAudit,
  requireUser,
  type Caller,
  type DemoCtx,
} from '../context';
import { hashPassword, newId, randomBase58 } from '../ids';
import { mintAccessToken, mintRefreshToken, refreshTokenUser } from '../tokens';
import type { ApiKeyRec, OrgRec, World } from '../world';
import type { Route } from '../router';
import { API_KEY_SCOPES, scopesAllowedForRole } from '../../rbac';
import type { ApiKeyScope, OrgRole } from '../../types';

const ASSIGNABLE_ROLES: OrgRole[] = ['admin', 'developer', 'viewer'];
const ADMIN_MANAGEABLE_ROLES: OrgRole[] = ['developer', 'viewer'];
const KEY_MANAGER_ROLES: OrgRole[] = ['owner', 'admin'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Like AuthService.mintTokensForUser: org claim only when the user has exactly one membership. */
function tokensForUser(ctx: DemoCtx, userId: string) {
  const memberships = ctx.world.members.filter((m) => m.userId === userId);
  const sole = memberships.length === 1 ? memberships[0] : null;
  return {
    accessToken: mintAccessToken({ sub: userId, org: sole?.orgId ?? null, role: sole?.role ?? null }, ctx.now),
    refreshToken: mintRefreshToken(userId),
  };
}

function tokensForOrg(ctx: DemoCtx, userId: string, orgId: string, role: OrgRole) {
  return {
    accessToken: mintAccessToken({ sub: userId, org: orgId, role }, ctx.now),
    refreshToken: mintRefreshToken(userId),
  };
}

const orgView = (org: OrgRec) => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  ownerId: org.ownerId,
  createdAt: org.createdAt,
  updatedAt: org.updatedAt,
});

/** OrgMemberGuard (+ RolesGuard when `roles` is given) for routes with :orgId. */
function requireOrgMember(ctx: DemoCtx, roles?: OrgRole[]): Caller & { orgId: string; role: OrgRole } {
  const caller = requireUser(ctx);
  const orgId = ctx.params.orgId;
  const role = membership(ctx.world, orgId, caller.user.id)?.role;
  if (!role) throw notFound('Organization not found');
  if (roles && !roles.includes(role)) throw forbidden(`Requires one of roles: ${roles.join(', ')}`);
  return { ...caller, orgId, role };
}

function requireSelectedOrg(caller: Caller): string {
  if (!caller.claims.org) throw badRequest('Select an organization first (POST /api/v1/auth/select-org)');
  return caller.claims.org;
}

const apiKeyView = (key: ApiKeyRec) => ({
  id: key.id,
  name: key.name,
  keyPrefix: key.keyPrefix,
  permissions: key.permissions,
  userId: key.userId,
  lastUsedAt: key.lastUsedAt,
  expiresAt: key.expiresAt,
});

function assertScopesForRole(role: OrgRole | null, requested: string[], subject: string) {
  if (!role) throw forbidden('Not a member of this organization');
  const allowed = new Set<string>(scopesAllowedForRole(role));
  const disallowed = requested.filter((s) => !allowed.has(s));
  if (disallowed.length > 0) throw forbidden(`${subject} (${role}) cannot grant scopes: ${disallowed.join(', ')}`);
}

function findManageableKey(ctx: DemoCtx, caller: Caller, orgId: string, keyId: string): ApiKeyRec {
  const key = ctx.world.apiKeys.find((k) => k.id === keyId);
  if (!key || key.orgId !== orgId || key.revokedAt) throw notFound('API key not found');
  const role = liveRole(ctx, caller);
  const isManager = role !== null && KEY_MANAGER_ROLES.includes(role);
  if (!isManager && key.userId !== caller.user.id) throw forbidden('You can only manage API keys you created');
  return key;
}

function validScopes(value: unknown): value is ApiKeyScope[] {
  return Array.isArray(value) && value.every((s) => (API_KEY_SCOPES as readonly unknown[]).includes(s));
}

function findUserByEmail(world: World, email: string) {
  const normalized = email.trim().toLowerCase();
  return world.users.find((u) => u.email.toLowerCase() === normalized);
}

export const identityRoutes: Route[] = [
  // ---------- auth ----------
  {
    method: 'POST',
    pattern: '/api/v1/auth/register',
    handler: (ctx) => {
      const { email, password, name } = ctx.body;
      assertValid([
        !isEmail(email) && 'email must be an email',
        !(isString(password) && password.length >= 8) && 'password must be longer than or equal to 8 characters',
        !(isString(name) && name.length >= 1) && 'name must be longer than or equal to 1 characters',
      ]);
      if (findUserByEmail(ctx.world, email as string)) throw conflict('An account with this email already exists');
      const user = {
        id: newId(),
        email: (email as string).trim(),
        name: name as string,
        passwordHash: hashPassword(password as string),
        avatarUrl: null,
        emailVerified: false,
        createdAt: iso(ctx),
      };
      ctx.world.users.push(user);
      return { id: user.id, email: user.email, name: user.name };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/auth/login',
    handler: (ctx) => {
      const { email, password } = ctx.body;
      assertValid([!isEmail(email) && 'email must be an email', !isString(password) && 'password must be a string']);
      const user = findUserByEmail(ctx.world, email as string);
      if (!user || user.passwordHash !== hashPassword(password as string)) {
        throw unauthorized('Invalid email or password');
      }
      return tokensForUser(ctx, user.id);
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/auth/refresh',
    handler: (ctx) => {
      const token = ctx.body.refreshToken;
      const userId = isString(token) ? refreshTokenUser(token) : null;
      if (!userId || ctx.world.revokedRefreshTokens.has(token as string)) {
        throw unauthorized('Invalid or expired refresh token');
      }
      if (!ctx.world.users.some((u) => u.id === userId)) throw unauthorized('Invalid or expired refresh token');
      return tokensForUser(ctx, userId);
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/auth/logout',
    handler: (ctx) => {
      if (isString(ctx.body.refreshToken)) ctx.world.revokedRefreshTokens.add(ctx.body.refreshToken);
      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/auth/forgot-password',
    handler: (ctx) => {
      assertValid([!isEmail(ctx.body.email) && 'email must be an email']);
      // No mail is sent in the demo; the response never reveals whether the account exists.
      return { success: true };
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/auth/reset-password',
    handler: (ctx) => {
      const { token, newPassword } = ctx.body;
      assertValid([
        !isString(token) && 'token must be a string',
        !(isString(newPassword) && newPassword.length >= 8) && 'newPassword must be longer than or equal to 8 characters',
      ]);
      // The demo never emails reset links, so no token can be valid.
      throw unauthorized('Invalid or expired reset token');
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/auth/select-org',
    handler: (ctx) => {
      const caller = requireUser(ctx);
      const orgId = ctx.body.orgId;
      assertValid([!isString(orgId) && 'orgId must be a UUID']);
      const member = membership(ctx.world, orgId as string, caller.user.id);
      if (!member) throw unauthorized('Not a member of this organization');
      return tokensForOrg(ctx, caller.user.id, member.orgId, member.role);
    },
  },

  // ---------- users ----------
  {
    method: 'GET',
    pattern: '/api/v1/users/me',
    handler: (ctx) => {
      const caller = requireUser(ctx);
      const { user } = caller;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        role: liveRole(ctx, caller),
      };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/v1/users/me',
    handler: (ctx) => {
      const caller = requireUser(ctx);
      const { name, avatarUrl } = ctx.body;
      assertValid([!optional(name, isString) && 'name must be a string']);
      if (isString(name)) caller.user.name = name;
      if (isString(avatarUrl) || avatarUrl === null) caller.user.avatarUrl = avatarUrl;
      recordAudit(ctx, caller, { orgId: null, action: 'user.updated', resourceType: 'user', resourceId: caller.user.id, bodyFields: ['name', 'avatarUrl'] });
      const { user } = caller;
      return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
    },
  },

  // ---------- organizations ----------
  {
    method: 'GET',
    pattern: '/api/v1/orgs',
    handler: (ctx) => {
      const caller = requireUser(ctx);
      const orgIds = new Set(ctx.world.members.filter((m) => m.userId === caller.user.id).map((m) => m.orgId));
      return ctx.world.orgs.filter((o) => orgIds.has(o.id)).map(orgView);
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/orgs',
    handler: (ctx) => {
      const caller = requireUser(ctx);
      const name = ctx.body.name;
      assertValid([!(isString(name) && name.length >= 1) && 'name must be longer than or equal to 1 characters']);
      const base = slugify(name as string) || 'org';
      let slug = base;
      for (let attempt = 1; ctx.world.orgs.some((o) => o.slug === slug); attempt++) slug = `${base}-${attempt}`;
      const now = iso(ctx);
      const org: OrgRec = { id: newId(), name: name as string, slug, ownerId: caller.user.id, createdAt: now, updatedAt: now };
      ctx.world.orgs.push(org);
      ctx.world.members.push({ id: newId(), orgId: org.id, userId: caller.user.id, role: 'owner', invitedBy: null, joinedAt: now, createdAt: now });
      recordAudit(ctx, caller, { orgId: org.id, action: 'org.created', resourceType: 'organization', resourceId: org.id });
      return { organization: orgView(org), ...tokensForOrg(ctx, caller.user.id, org.id, 'owner') };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/orgs/:orgId',
    handler: (ctx) => {
      const { orgId } = requireOrgMember(ctx);
      return orgView(ctx.world.orgs.find((o) => o.id === orgId)!);
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/orgs/:orgId/members',
    handler: (ctx) => {
      const { orgId } = requireOrgMember(ctx);
      return ctx.world.members
        .filter((m) => m.orgId === orgId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((m) => {
          const user = ctx.world.users.find((u) => u.id === m.userId)!;
          return { userId: m.userId, role: m.role, joinedAt: m.joinedAt, user: { id: user.id, email: user.email, name: user.name } };
        });
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/orgs/:orgId/members',
    handler: (ctx) => {
      const caller = requireOrgMember(ctx, ['owner', 'admin']);
      const { email, role } = ctx.body;
      assertValid([
        !isEmail(email) && 'email must be an email',
        !ASSIGNABLE_ROLES.includes(role as OrgRole) && `role must be one of the following values: ${ASSIGNABLE_ROLES.join(', ')}`,
      ]);
      const target = role as OrgRole;
      if (caller.role !== 'owner' && !ADMIN_MANAGEABLE_ROLES.includes(target)) {
        throw forbidden(`Only the owner can invite members as ${target}`);
      }
      const user = findUserByEmail(ctx.world, email as string);
      if (!user) throw notFound('No registered user with that email — they must sign up first');
      if (membership(ctx.world, caller.orgId, user.id)) throw conflict('User is already a member of this organization');
      const now = iso(ctx);
      const member = { id: newId(), orgId: caller.orgId, userId: user.id, role: target, invitedBy: caller.user.id, joinedAt: now, createdAt: now };
      ctx.world.members.push(member);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'member.added', resourceType: 'member', resourceId: user.id, bodyFields: ['email', 'role'] });
      return member;
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/v1/orgs/:orgId/members/:userId',
    handler: (ctx) => {
      const caller = requireOrgMember(ctx, ['owner']);
      const role = ctx.body.role as OrgRole;
      assertValid([!ASSIGNABLE_ROLES.includes(role) && `role must be one of the following values: ${ASSIGNABLE_ROLES.join(', ')}`]);
      const member = membership(ctx.world, caller.orgId, ctx.params.userId);
      if (!member) throw notFound('Member not found');
      if (member.role === 'owner') throw forbidden("The organization's owner role cannot be changed here");
      member.role = role;
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'member.role_updated', resourceType: 'member', resourceId: member.userId, bodyFields: ['role'] });
      return member;
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/orgs/:orgId/members/:userId',
    handler: (ctx) => {
      const caller = requireOrgMember(ctx, ['owner', 'admin']);
      const member = membership(ctx.world, caller.orgId, ctx.params.userId);
      if (!member) throw notFound('Member not found');
      if (member.role === 'owner') throw forbidden('Cannot remove the organization owner');
      if (caller.role !== 'owner' && !ADMIN_MANAGEABLE_ROLES.includes(member.role)) {
        throw forbidden(`Only the owner can remove a member with role ${member.role}`);
      }
      ctx.world.members = ctx.world.members.filter((m) => m !== member);
      recordAudit(ctx, caller, { orgId: caller.orgId, action: 'member.removed', resourceType: 'member', resourceId: member.userId });
      return { success: true };
    },
  },
  {
    method: 'GET',
    pattern: '/api/v1/orgs/:orgId/audit-logs',
    handler: (ctx) => {
      const { orgId } = requireOrgMember(ctx, ['owner', 'admin']);
      const cursor = ctx.query.get('cursor');
      const limitRaw = ctx.query.get('limit');
      const limit = limitRaw === null ? 50 : Number(limitRaw);
      assertValid([
        cursor !== null && !/^\d{1,18}$/.test(cursor) && 'cursor must be a numeric id',
        !(Number.isInteger(limit) && limit >= 1 && limit <= 100) && 'limit must not be greater than 100',
      ]);
      const rows = ctx.world.audit
        .filter((e) => e.orgId === orgId && (cursor === null || Number(e.id) < Number(cursor)))
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, limit);
      // Strip the internal orgId column.
      const items = rows.map(({ orgId: _orgId, ...entry }) => entry);
      const last = items[items.length - 1];
      return { items, nextCursor: items.length === limit && last ? last.id : null };
    },
  },

  // ---------- API keys ----------
  {
    method: 'GET',
    pattern: '/api/v1/api-keys',
    handler: (ctx) => {
      const orgId = requireSelectedOrg(requireUser(ctx));
      return ctx.world.apiKeys.filter((k) => k.orgId === orgId && !k.revokedAt).map(apiKeyView);
    },
  },
  {
    method: 'POST',
    pattern: '/api/v1/api-keys',
    handler: (ctx) => {
      const caller = requireUser(ctx);
      const orgId = requireSelectedOrg(caller);
      const { name, permissions, testMode } = ctx.body;
      assertValid([
        !(isString(name) && name.length >= 1) && 'name must be longer than or equal to 1 characters',
        !validScopes(permissions) && `each value in permissions must be one of the following values: ${API_KEY_SCOPES.join(', ')}`,
        !optional(testMode, isBool) && 'testMode must be a boolean value',
      ]);
      const scopes = permissions as ApiKeyScope[];
      if (scopes.length === 0) throw badRequest('At least one permission scope is required');
      assertScopesForRole(membership(ctx.world, orgId, caller.user.id)?.role ?? null, scopes, 'Your role');
      const rawKey = `${testMode ? 'rc_test_' : 'rc_live_'}${randomBase58(44)}`;
      const key: ApiKeyRec = {
        id: newId(),
        orgId,
        userId: caller.user.id,
        name: name as string,
        keyPrefix: rawKey.slice(0, 12),
        permissions: scopes,
        lastUsedAt: null,
        expiresAt: null,
        createdAt: iso(ctx),
        revokedAt: null,
      };
      ctx.world.apiKeys.push(key);
      recordAudit(ctx, caller, { orgId, action: 'api_key.created', resourceType: 'api_key', resourceId: key.id, bodyFields: ['name', 'permissions'] });
      return { id: key.id, name: key.name, keyPrefix: key.keyPrefix, permissions: scopes, rawKey };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/v1/api-keys/:keyId',
    handler: (ctx) => {
      const caller = requireUser(ctx);
      const orgId = requireSelectedOrg(caller);
      const { name, permissions } = ctx.body;
      assertValid([
        !optional(name, isString) && 'name must be a string',
        permissions !== undefined && !validScopes(permissions) && `each value in permissions must be one of the following values: ${API_KEY_SCOPES.join(', ')}`,
      ]);
      const key = findManageableKey(ctx, caller, orgId, ctx.params.keyId);
      if (permissions !== undefined) {
        const creatorRole = key.userId ? (membership(ctx.world, orgId, key.userId)?.role ?? null) : null;
        if (!creatorRole) throw forbidden("The key's creator is no longer a member of this organization");
        assertScopesForRole(creatorRole, permissions as string[], "The key creator's role");
        key.permissions = permissions as string[];
      }
      if (isString(name)) key.name = name;
      recordAudit(ctx, caller, { orgId, action: 'api_key.updated', resourceType: 'api_key', resourceId: key.id, bodyFields: ['name', 'permissions'] });
      return apiKeyView(key);
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/v1/api-keys/:keyId',
    handler: (ctx) => {
      const caller = requireUser(ctx);
      const orgId = requireSelectedOrg(caller);
      const key = findManageableKey(ctx, caller, orgId, ctx.params.keyId);
      key.revokedAt = iso(ctx);
      recordAudit(ctx, caller, { orgId, action: 'api_key.revoked', resourceType: 'api_key', resourceId: key.id });
      return { success: true };
    },
  },
];
