import { forbidden, unauthorized } from './http';
import { decodeAccessClaims, type AccessClaims } from './tokens';
import type { MemberRec, UserRec, World } from './world';
import { scopesAllowedForRole } from '../rbac';
import type { ApiKeyScope, OrgRole } from '../types';

export type Service = 'identity' | 'cdn' | 'storage' | 'analytics';

/** Everything a mock handler sees about one backend call. */
export interface DemoCtx {
  world: World;
  service: Service;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: Record<string, unknown>;
  accessToken?: string;
  ip: string | null;
  userAgent: string | null;
  /** Absolute origin of the dashboard (for same-origin upload and signed URLs). */
  origin: string;
  now: number;
}

export interface Caller {
  user: UserRec;
  claims: AccessClaims;
}

export interface OrgCaller extends Caller {
  orgId: string;
  role: OrgRole;
}

/** JwtOnlyGuard: a valid, unexpired access token for a user that still exists. */
export function requireUser(ctx: DemoCtx): Caller {
  if (!ctx.accessToken) throw unauthorized();
  const claims = decodeAccessClaims(ctx.accessToken);
  if (!claims || claims.exp * 1000 <= ctx.now) throw unauthorized();
  const user = ctx.world.users.find((u) => u.id === claims.sub);
  if (!user) throw unauthorized();
  return { user, claims };
}

export function membership(world: World, orgId: string, userId: string): MemberRec | undefined {
  return world.members.find((m) => m.orgId === orgId && m.userId === userId);
}

/** The live role in the token's org (like the services: never the stale role claim). */
export function liveRole(ctx: DemoCtx, caller: Caller): OrgRole | null {
  if (!caller.claims.org) return null;
  return membership(ctx.world, caller.claims.org, caller.user.id)?.role ?? null;
}

/**
 * cdn/storage/analytics AuthGuard + ScopeGuard: an org-scoped token whose
 * holder's live role grants `scope`.
 */
export function requireScope(ctx: DemoCtx, scope: ApiKeyScope): OrgCaller {
  const caller = requireUser(ctx);
  const orgId = caller.claims.org;
  if (!orgId) throw forbidden('This credential is not scoped to an organization');
  const role = liveRole(ctx, caller);
  if (!role) throw unauthorized('Not a member of this organization');
  if (!scopesAllowedForRole(role).includes(scope)) {
    throw forbidden(`Role "${role}" lacks the "${scope}" permission`);
  }
  return { ...caller, orgId, role };
}

/** Audit interceptor: records a successful mutation in the org's audit log. */
export function recordAudit(
  ctx: DemoCtx,
  caller: Caller,
  entry: {
    orgId: string | null;
    action: string;
    resourceType: string | null;
    resourceId: string | null;
    bodyFields?: string[];
  },
): void {
  const metadata: Record<string, unknown> = { params: { ...ctx.params } };
  if (entry.bodyFields?.length) {
    metadata.body = Object.fromEntries(entry.bodyFields.filter((f) => f in ctx.body).map((f) => [f, ctx.body[f]]));
  }
  ctx.world.auditSeq += 1;
  ctx.world.audit.push({
    id: String(ctx.world.auditSeq),
    orgId: entry.orgId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    ipAddress: ctx.ip,
    userAgent: ctx.userAgent,
    metadata,
    createdAt: new Date(ctx.now).toISOString(),
    user: { id: caller.user.id, email: caller.user.email, name: caller.user.name },
    apiKey: null,
  });
}

export const iso = (ctx: DemoCtx) => new Date(ctx.now).toISOString();

// ---------- tiny validators (class-validator messages) ----------

export const isString = (v: unknown): v is string => typeof v === 'string';
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: unknown): v is string => isString(v) && EMAIL.test(v);

export function isHttpUrl(v: unknown): v is string {
  if (!isString(v)) return false;
  try {
    const url = new URL(v);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export function optional<T>(value: unknown, check: (v: unknown) => v is T): boolean {
  return value === undefined || check(value);
}
