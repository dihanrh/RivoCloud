# Phase 1 — Stage 11: Security + RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the platform safe for real tenants: roles and API-key scopes are enforced on every route of every service (EDD 11.1, "viewer cannot create zones"), every mutation lands in `audit_logs` (11.2), and auth plus API traffic is throttled by a Redis sliding window (11.3, "auth endpoints limited to 10 req/min per IP"). Owners and Admins can see members, API keys, and the audit log on a new dashboard Settings page.

**Architecture:** A new workspace package `@rivocloud/security` holds the cross-cutting pieces every NestJS service now needs: the role→scope matrix, one `ScopeGuard`, an `AuditInterceptor` + `AuditWriter`, a `RateLimitInterceptor` over a `SlidingWindowLimiter`, and a `SecurityModule.forRoot()` that registers both interceptors globally. Guards run before interceptors in NestJS, so both interceptors always see the `request.auth` that each service's existing `AuthGuard` sets. The Identity Service closes the authorization holes the earlier stages left: org routes check membership of the org in the URL, `verify-token` returns the caller's *current* role from the database instead of the JWT's possibly stale one, and API keys are capped at their creator's current role. Audit logs are read through a new Identity endpoint, because all services share one Postgres.

**Tech Stack:** NestJS 10 guards/interceptors/`Reflector`, `ioredis` 5 (`MULTI` with `ZREMRANGEBYSCORE`/`ZADD`/`ZCARD`/`ZRANGE`/`PEXPIRE`), Prisma 5 (`auditLog` model already in the schema; no migration), Express `trust proxy`, Next.js 15 route handlers + TanStack Query 5 (`useInfiniteQuery` for the audit log), Vitest 2 with `unplugin-swc`.

**Spec:**
- [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md): Section 8.2 (RBAC matrix + API key scopes), 8.3 (rate limits), 8.7 (audit logging), 6.5 (`audit_logs` table), Section 11 block 11 (11.1–11.3), Month 6 roadmap ("Dashboard: Settings page", "Audit logs visible in dashboard")
- [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md): Section 5.8, Section 7 Stage 11 row
- [`docs/concepts/security-rbac-and-audit-logging.md`](../../concepts/security-rbac-and-audit-logging.md)

## Global Constraints

- Role matrix is EDD 8.2 exactly: Owner full; Admin full except Billing = read, Members = invite/remove; Developer full on Zone/Storage/Analytics, no Billing/Members; Viewer read on Zone/Storage, full Analytics (read-only service), nothing else.
- API key scopes are exactly: `zone:read zone:write zone:delete cache:invalidate storage:read storage:write storage:delete analytics:read billing:read`.
- Rate limits are EDD 8.3 exactly: auth login+register 10/60s per IP; forgot-password 5/3600s per IP; general API 1000/60s per API key or user; cache invalidation 100/60s per zone ID; analytics 60/60s per user/key.
- Sliding window uses Redis sorted sets (`ZADD` + count). No Lua scripts.
- `audit_logs` is append-only. No code in this stage issues an UPDATE or DELETE against it.
- Request bodies are never copied wholesale into audit metadata. Only fields named in an `@Audit({ bodyFields })` allowlist are copied, and no allowlist may name a password, token, or key field.
- ESM with NodeNext: relative imports end in `.js`. Unit tests are `*.test.ts`, integration tests `*.integration.test.ts`.
- Commits carry no `Co-Authored-By` or other Claude attribution trailer.

## Design Decisions (read before starting)

1. **A shared package, superseding Stage 10's "no shared package" constraint for this cross-cutting code.** The scope guards were copied into cdn-service, storage-service, and analytics-service with comments saying "keep in sync by hand until a third consumer justifies a shared package". This stage adds a fourth consumer (identity) plus two more mechanisms that every service needs. `@rivocloud/security` is consumed from source like `@rivocloud/db` (`"main": "src/index.ts"`). `src/rbac/scopes.ts` has zero imports, so the dashboard can check it for drift in a test.
2. **One `ScopeGuard` replaces `ZoneScopeGuard`, `StorageScopeGuard`, and `AnalyticsAccessGuard`.** A JWT caller passes when `scopesAllowedForRole(role)` contains the required scope. An API-key caller passes when its `permissions` contain it. Because the role→scope table *is* the EDD matrix, both paths stay consistent by construction. A route behind `ScopeGuard` with no `@RequireScope` is **denied** (403), not allowed.
3. **Analytics API keys need `analytics:read`, not `zone:read`.** Stage 9 used `zone:read` because nothing checked `analytics:read`; the EDD defines the dedicated scope. Existing keys without it lose analytics access, which is acceptable pre-launch.
4. **Roles are read live, not from the JWT.** A JWT's `role` claim can be up to `JWT_ACCESS_TTL_SECONDS` (900s) stale after a demotion or removal. `POST /internal/auth/verify-token` and identity's own guards now look up `organization_members` for `(claims.org, claims.sub)`. A missing membership returns 401 `"No longer a member of this organization"`. This costs one indexed query per request on a hop that already exists.
5. **API keys are capped at their creator's current role.** `verifyRawKey` returns `permissions ∩ scopesAllowedForRole(creatorCurrentRole)`. A key whose creator has left the org (or has `userId = null`) is invalid (401).
6. **Org routes check membership of the org in the URL.** A new `OrgMemberGuard` loads the caller's membership in `:orgId` (404 `"Organization not found"` if none) and stores `request.orgRole`. `@Roles(...)` then checks `request.orgRole`, never the JWT. This fixes two holes: any user could list any org's members, and an Admin of org A could manage org B.
7. **Member-management rules (my call, within EDD "Admin: Invite/Remove; Owner: Full").** Nobody can assign the `owner` role through these endpoints (400), because ownership transfer is out of scope. Only the Owner may change a member's role (`PATCH`). Owner and Admin may invite and remove; an Admin may only invite `developer`/`viewer` and only remove `developer`/`viewer` members (403 otherwise). The owner can never be removed or changed (existing rule).
8. **Members list never exposes `passwordHash`.** `listMembers` currently returns `include: { user: true }`, which is the full user row. It changes to the fixed shape `{ userId, role, joinedAt, user: { id, email, name } }`.
9. **API-key management rules (my call).** Any member may list keys and create keys, with scopes capped by their role (existing behavior). Owner/Admin may update or revoke any key; other roles only keys they created (403 otherwise).
10. **Audit is opt-in per route, and the opt-in is enforced.** Each mutating handler (POST/PUT/PATCH/DELETE) carries `@Audit(action, options)` or `@NoAudit()`. A unit test in each service discovers every `*.controller.ts` with `import.meta.glob` and fails on any mutating handler with neither. Action names follow the schema's `'zone.created'` style. The EDD's `${method}.${className}` derivation is not used, because it cannot produce those names.
11. **Only successful mutations are audited, and the write is awaited but never fails the request.** The interceptor writes after the handler resolves and before the response is sent, so tests are deterministic. A write error is logged with Nest's `Logger` and swallowed. Denied attempts (guard 403s) and failed handlers are not logged in this stage.
12. **Session endpoints are not audited.** All `api/v1/auth/*` routes (register, login, refresh, logout, verify-email, forgot/reset password, select-org) and every `internal/*` route are `@NoAudit()`. Account changes under `users/me` are audited.
13. **Rate limiting is a global interceptor, not a guard.** Global guards run before controller guards, so they would not see `request.auth`; interceptors run after all guards. Every request with `request.auth` gets the `general` policy. Routes add policies with `@RateLimit(...)` on the handler or class, and every applicable policy must pass. The rejected hit still counts toward the window. Over the limit → 429 `{ statusCode: 429, message: 'Too many requests' }` with a `Retry-After` header (seconds, ≥ 1). If Redis errors, the request is **allowed** and a warning is logged (fail-open).
14. **The general limit is shared across services.** Keys are `ratelimit:{policy}:{keyValue}` in the shared Redis, so 1000/min means 1000 across cdn + storage + analytics + identity, matching the EDD's "per API key or user JWT".
15. **Client IP comes from Express `trust proxy`.** The new base env var `TRUST_PROXY` defaults to `loopback, linklocal, uniquelocal`, so `X-Forwarded-For` is honored only from private hops: the dashboard server or Traefik, never the public internet. The dashboard forwards the browser's `X-Forwarded-For` and `User-Agent` on every backend call. Without that, every login through the dashboard would share one IP bucket.
16. **Rate limiting can be disabled by env for test suites.** The new base env var `RATE_LIMIT_ENABLED` (`'true'|'false'`, default `'true'`) is set to `'false'` in every service's `vitest.integration.config.ts`, because existing suites register far more than 10 users a minute. Rate-limit tests turn it back on with `.overrideProvider(SECURITY_OPTIONS)`.

**Non-goals:** billing permissions (Stage 12), the Notification Service and customer webhooks, edge-proxy per-IP limiting (EDD 8.6), Traefik/Cloudflare control-plane limits, audit retention and MinIO archiving, logging denied attempts, ownership transfer, and the scheduler (it exposes only `internal/*` routes).

## Review Focus

1. **A member of org A addressing org B by ID.** List members, invite, change role, or read audit logs for org B → 404, never data. Tests: Task 4 `cross-org access returns 404`, Task 5 `audit logs are org-scoped`.
2. **A demoted or removed member still holding a valid JWT.** Their next cdn/storage call must reflect the new role immediately. Tests: Task 4 `verify-token returns the live role` and `verify-token rejects a removed member`.
3. **Every dashboard user sharing one IP bucket** because the dashboard calls identity from one server IP. Tests: Task 5 `separate X-Forwarded-For clients get separate buckets`, Task 9 `forwards x-forwarded-for and user-agent`.
4. **Secrets leaking into audit rows.** A password change must not store the password. Test: Task 5 `password change audit row has no password fields`.
5. **Redis or Postgres hiccups turning into user-facing 500s** from the rate limiter or the audit writer. Tests: Task 2 `fails open when the limiter throws`, Task 3 `a writer failure does not fail the request`.

## File Structure

```
packages/config/src/env.ts                                  # modified: + TRUST_PROXY, RATE_LIMIT_ENABLED
packages/security/                                          # new package @rivocloud/security
  package.json, tsconfig.json, vitest.config.ts, vitest.integration.config.ts, eslint (inherits root)
  src/index.ts
  src/rbac/scopes.ts (+ .test.ts)                           # pure: ORG_ROLES, API_KEY_SCOPES, scopesAllowedForRole, isOrgRole
  src/rbac/auth-context.ts                                  # SecurityAuthContext type
  src/rbac/scope.guard.ts (+ .test.ts)                      # RequireScope, ScopeGuard
  src/rate-limit/policies.ts                                # RATE_LIMITS
  src/rate-limit/rate-limit.decorator.ts
  src/rate-limit/sliding-window.ts (+ .integration.test.ts)
  src/rate-limit/rate-limit.interceptor.ts (+ .test.ts)
  src/audit/audit.decorator.ts
  src/audit/audit-writer.ts (+ .integration.test.ts)
  src/audit/audit.interceptor.ts (+ .test.ts)
  src/audit/audit-coverage.ts (+ .test.ts)
  src/http/trust-proxy.ts
  src/security.module.ts
apps/identity-service/src/
  organizations/roles.ts, roles.test.ts                     # deleted (moved to package)
  organizations/org-member.guard.ts (+ test via integration)
  organizations/roles.guard.ts, organizations.controller.ts, organizations.service.ts   # modified
  organizations/membership.service.ts                       # currentRole()
  api-keys/api-keys.service.ts, api-keys.controller.ts      # modified
  auth/auth-guard.ts, auth/jwt-only.guard.ts, internal/internal.controller.ts           # modified
  audit-logs/audit-logs.controller.ts, audit-logs.service.ts, audit-logs.module.ts, dto/list-audit-logs.dto.ts
  audit-logs/audit-logs.controller.integration.test.ts
  security/rate-limit.integration.test.ts
  audit-coverage.test.ts
  app.module.ts, main.ts, vitest.integration.config.ts      # modified
apps/cdn-service/src/        auth/* (guard swap), controllers, app.module.ts, main.ts, audit-coverage.test.ts
apps/storage-service/src/    auth/* (guard swap), redis/redis.module.ts (new), controllers, app.module.ts, main.ts, audit-coverage.test.ts
apps/analytics-service/src/  auth/* (guard swap), redis/redis.module.ts (new), analytics.controller.ts, app.module.ts, main.ts, audit-coverage.test.ts
apps/dashboard/src/
  lib/forwarded-headers.ts, lib/proxy.ts, lib/rbac.ts (+ rbac.test.ts), lib/types.ts
  app/api/auth/login/route.ts, app/api/auth/register/route.ts, app/api/me/route.ts
  app/api/orgs/[orgId]/members/route.ts, app/api/orgs/[orgId]/members/[userId]/route.ts
  app/api/orgs/[orgId]/audit-logs/route.ts
  app/api/api-keys/route.ts, app/api/api-keys/[keyId]/route.ts
  hooks/use-members.ts, hooks/use-api-keys.ts, hooks/use-audit-logs.ts, hooks/use-me.ts
  components/settings/members-panel.tsx, api-keys-panel.tsx, audit-log-panel.tsx (+ tests)
  app/(app)/settings/page.tsx, components/layout/app-shell.tsx
turbo.json, .env.example                                    # + TRUST_PROXY, RATE_LIMIT_ENABLED
docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md, docs/concepts/security-rbac-and-audit-logging.md
```

---

## Tasks

Each task ends with its own commit. Run commands from the repo root.

### Task 1: `@rivocloud/security` package — RBAC scopes and `ScopeGuard`

**Files:** Create `packages/security/{package.json,tsconfig.json,vitest.config.ts,vitest.integration.config.ts,src/index.ts}`, `src/rbac/scopes.ts`, `src/rbac/scopes.test.ts`, `src/rbac/auth-context.ts`, `src/rbac/scope.guard.ts`, `src/rbac/scope.guard.test.ts`. Modify `pnpm-lock.yaml` (via `pnpm install`).

**Interfaces — Produces:**
- `ORG_ROLES`, `OrgRole`, `API_KEY_SCOPES`, `ApiKeyScope`, `scopesAllowedForRole(role: OrgRole): ApiKeyScope[]`, `isOrgRole(v: string): v is OrgRole`: identical values to today's `apps/identity-service/src/organizations/roles.ts`. `scopes.ts` imports nothing.
- `interface SecurityAuthContext { type: 'jwt' | 'api_key'; userId: string | null; orgId: string | null; role: string | null; apiKeyId?: string; permissions?: string[] }`
- `REQUIRED_SCOPE_KEY = 'requiredScope'`, `RequireScope(scope: ApiKeyScope)` (method or class decorator), `@Injectable() class ScopeGuard implements CanActivate` (constructor `(reflector: Reflector)`; handler metadata overrides class metadata).

- [ ] **Step 1:** Scaffold the package. Copy `packages/config`'s `package.json` shape (`"type": "module"`, `main`/`types` → `src/index.ts`, scripts `lint`, `typecheck`, `test:unit: vitest run --config vitest.config.ts`, `test:integration: vitest run --config vitest.integration.config.ts`). Dependencies: `@nestjs/common`, `@nestjs/core`, `@rivocloud/db: workspace:*`, `ioredis`, `rxjs`, `reflect-metadata`, at the versions cdn-service uses. Dev dependencies: `@nestjs/testing`, `@swc/core`, `unplugin-swc`, `vitest`, `typescript`, `@types/node`. Vitest configs mirror cdn-service's (swc plugin; integration: `fileParallelism: false`, `testTimeout: 20000`). Run `pnpm install`.
- [ ] **Step 2: Write failing tests.** `scopes.test.ts`: viewer → exactly `['zone:read','storage:read','analytics:read']`; developer → every scope except `billing:read`; owner and admin → all 9; `isOrgRole('superuser') === false`. `scope.guard.test.ts` (build an `ExecutionContext` stub as in `apps/cdn-service/src/auth/zone-scope.guard.test.ts`):
  - `viewer JWT is allowed zone:read and denied zone:write` (403 message `Role "viewer" lacks the "zone:write" permission`)
  - `developer JWT is denied billing:read`
  - `api_key passes only with the exact scope` (message `API key is missing the "zone:write" scope`)
  - `a route with no RequireScope is denied` (message `Route has no scope requirement`)
  - `handler-level scope overrides class-level scope`
  - `JWT with null role is denied`
- [ ] **Step 3:** Run `pnpm --filter @rivocloud/security test:unit`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement `scopes.ts` (move the tables verbatim), `auth-context.ts`, and `scope.guard.ts` (`reflector.getAllAndOverride(REQUIRED_SCOPE_KEY, [handler, class])`). Export everything from `src/index.ts`.
- [ ] **Step 5:** Run `pnpm --filter @rivocloud/security test:unit typecheck lint`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(security): add shared RBAC scope table and ScopeGuard package`.

### Task 2: Rate limiting core

**Files:** Create `src/rate-limit/{policies.ts,rate-limit.decorator.ts,sliding-window.ts,sliding-window.integration.test.ts,rate-limit.interceptor.ts,rate-limit.interceptor.test.ts}`. Modify `src/index.ts`.

**Interfaces — Produces:**
- `type RateLimitKey = 'ip' | 'principal' | { param: string }`
- `interface RateLimitPolicy { name: string; limit: number; windowSeconds: number; key: RateLimitKey }`
- `RATE_LIMITS = { auth: {name:'auth',limit:10,windowSeconds:60,key:'ip'}, forgotPassword: {name:'forgot-password',limit:5,windowSeconds:3600,key:'ip'}, general: {name:'general',limit:1000,windowSeconds:60,key:'principal'}, cacheInvalidation: {name:'cache-invalidation',limit:100,windowSeconds:60,key:{param:'zoneId'}}, analytics: {name:'analytics',limit:60,windowSeconds:60,key:'principal'} } as const satisfies Record<string, RateLimitPolicy>`
- `RATE_LIMIT_KEY = 'rateLimits'`, `RateLimit(...policies: RateLimitPolicy[])` (method or class; handler and class policies are concatenated)
- `class SlidingWindowLimiter { constructor(redis: Redis); hit(key: string, limit: number, windowSeconds: number, nowMs?: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> }`
- Tokens `SECURITY_REDIS = Symbol('SECURITY_REDIS')`, `SECURITY_OPTIONS = Symbol('SECURITY_OPTIONS')`, `interface SecurityOptions { rateLimitEnabled: boolean }`
- `@Injectable() class RateLimitInterceptor` (constructor `(reflector, limiter: SlidingWindowLimiter, @Inject(SECURITY_OPTIONS) options)`)

- [ ] **Step 1: Write failing tests.**
  `sliding-window.integration.test.ts` (real Redis from `REDIS_URL`, unique key prefix per test, `DEL` in `afterEach`):
  - `allows exactly limit hits then rejects`: limit 3 → three `allowed: true`, the fourth `allowed: false`.
  - `retryAfterSeconds counts down to the oldest hit leaving the window`: hits at now=0, 1000, 2000 ms, limit 3, window 10 s; a hit at 2500 → `{allowed:false, retryAfterSeconds: 8}`.
  - `hits older than the window stop counting`: limit 1, window 1 s; a hit at 0, then a hit at 1001 → allowed.
  - `sets a TTL on the key` (`PTTL` > 0 and ≤ window ms).
  `rate-limit.interceptor.test.ts` (fake limiter object, `Reflector` with handler metadata, stub `ExecutionContext`/`CallHandler`):
  - `applies general to authenticated requests keyed by user` (limiter sees `ratelimit:general:user:u1`)
  - `keys API-key callers by apiKeyId` (`ratelimit:general:apikey:k1`)
  - `applies ip policies to anonymous requests` (`ratelimit:auth:ip:203.0.113.9` from `request.ip`)
  - `param policies key by the route param` (`ratelimit:cache-invalidation:zone:z1`)
  - `skips principal policies when request.auth is absent`
  - `rejects with 429 and Retry-After` (thrown `HttpException` status 429, body `{ statusCode: 429, message: 'Too many requests' }`, `response.setHeader('Retry-After', '8')` called)
  - `fails open when the limiter throws` (`next.handle` called; a warning logged)
  - `does nothing when rateLimitEnabled is false`
- [ ] **Step 2:** Run `pnpm --filter @rivocloud/security test:unit` and `test:integration`. Expected: FAIL.
- [ ] **Step 3:** Implement `hit()` as one `MULTI`: `ZREMRANGEBYSCORE key -inf (now - windowMs)`, `ZADD key now "<now>-<randomUUID>"`, `ZCARD key`, `ZRANGE key 0 0 WITHSCORES`, `PEXPIRE key windowMs`. `allowed = count <= limit`. `retryAfterSeconds = max(1, ceil((oldestScore + windowMs - now) / 1000))` when rejected, else 0. Key value per `RateLimitKey`: `ip` → `ip:${request.ip ?? 'unknown'}`, `principal` → `apikey:${auth.apiKeyId}` if present else `user:${auth.userId}`, `{param}` → `${param without trailing "Id"}:${request.params[param]}`. Evaluate policies in order and stop at the first rejection.
- [ ] **Step 4:** Run both suites. Expected: PASS.
- [ ] **Step 5:** Commit `feat(security): add Redis sliding-window rate limiter and interceptor`.

### Task 3: Audit core, `SecurityModule`, trust proxy, base env

**Files:** Create `src/audit/{audit.decorator.ts,audit-writer.ts,audit-writer.integration.test.ts,audit.interceptor.ts,audit.interceptor.test.ts,audit-coverage.ts,audit-coverage.test.ts}`, `src/http/trust-proxy.ts`, `src/security.module.ts`. Modify `src/index.ts`, `packages/config/src/env.ts` (+ `env.test.ts`), `turbo.json`, `.env.example`.

**Interfaces — Produces:**
- `interface AuditOptions { resourceType: string; idParam?: string; idPath?: string; orgIdPath?: string; detachOrg?: boolean; bodyFields?: string[] }`
- `AUDIT_KEY = 'audit'`, `NO_AUDIT_KEY = 'noAudit'`, `Audit(action: string, options: AuditOptions)`, `NoAudit()` (method or class)
- `interface AuditEntry { orgId: string | null; userId: string | null; apiKeyId: string | null; action: string; resourceType: string; resourceId: string | null; ipAddress: string | null; userAgent: string | null; requestId: string | null; metadata: Record<string, unknown> }`
- `SECURITY_PRISMA = Symbol('SECURITY_PRISMA')`; `@Injectable() class AuditWriter { write(entry: AuditEntry): Promise<void> }` (`prisma.auditLog.create`, with `ipAddress` passed only if `net.isIP()` is non-zero)
- `@Injectable() class AuditInterceptor` (constructor `(reflector, writer: AuditWriter)`)
- `findUnauditedMutations(controllers: Function[]): string[]` returns `"<ClassName>.<method>"` for each handler whose `METHOD_METADATA` (from `@nestjs/common/constants`) is POST/PUT/PATCH/DELETE and which has neither `AUDIT_KEY` nor `NO_AUDIT_KEY` on the handler or class.
- `configureTrustProxy(app: INestApplication, value: string): void` → `app.getHttpAdapter().getInstance().set('trust proxy', value)`
- `SecurityModule.forRoot({ redisToken, prismaToken, envToken }: { redisToken: string | symbol; prismaToken: string | symbol; envToken: string | symbol }): DynamicModule`. The module is global. It provides `SECURITY_REDIS` (useExisting redisToken), `SECURITY_PRISMA` (useExisting prismaToken), `SECURITY_OPTIONS` (factory `env => ({ rateLimitEnabled: env.RATE_LIMIT_ENABLED })`), `SlidingWindowLimiter`, `AuditWriter`, `ScopeGuard`, and `APP_INTERCEPTOR` → `RateLimitInterceptor` then `APP_INTERCEPTOR` → `AuditInterceptor`. It exports `ScopeGuard`.
- Base env: `TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal')`, `RATE_LIMIT_ENABLED: z.enum(['true','false']).default('true').transform(v => v === 'true')`

- [ ] **Step 1: Write failing tests.**
  `audit.interceptor.test.ts` (fake writer):
  - `writes nothing for handlers without @Audit`
  - `builds the entry from auth, params, response, and headers`: route `@Audit('zone.created', { resourceType: 'zone', idPath: 'id', bodyFields: ['name'] })`, request `{ auth: {type:'jwt',userId:'u1',orgId:'o1',role:'owner'}, params: {}, body: { name: 'z', originUrl: 'x' }, ip: '203.0.113.9', headers: { 'user-agent': 'UA', 'x-request-id': 'r1' } }`, response `{ id: 'zone-1' }` → the exact `AuditEntry` with `metadata: { params: {}, body: { name: 'z' } }` (no `originUrl`)
  - `orgId prefers params.orgId, then orgIdPath, and detachOrg forces null`
  - `idParam reads the route param`
  - `records apiKeyId for API-key callers`
  - `a writer failure does not fail the request` (writer rejects → the observable still emits the handler's value; an error is logged)
  - `does not write when the handler throws`
  `audit-coverage.test.ts`: a fixture controller with an undecorated `@Post()` → `['Fixture.create']`; with `@NoAudit()` on the class → `[]`; a `@Get()` → ignored.
  `audit-writer.integration.test.ts`: writes a row and reads it back; `ipAddress: 'not-an-ip'` is stored as null; `ipAddress: '::ffff:127.0.0.1'` round-trips.
  `packages/config/src/env.test.ts`: defaults → `TRUST_PROXY === 'loopback, linklocal, uniquelocal'`, `RATE_LIMIT_ENABLED === true`; `'false'` → `false`.
- [ ] **Step 2:** Run the suites. Expected: FAIL.
- [ ] **Step 3:** Implement. The interceptor uses `next.handle().pipe(mergeMap(async (body) => { await writer.write(entry).catch(err => logger.error(...)); return body; }))`. `idPath`/`orgIdPath` are dot paths read from the handler's return value; a non-string result becomes null.
- [ ] **Step 4:** Add `TRUST_PROXY` and `RATE_LIMIT_ENABLED` to `.env.example` (commented) and to `turbo.json` `test:integration.env`.
- [ ] **Step 5:** Run `pnpm --filter @rivocloud/security --filter @rivocloud/config test:unit test:integration typecheck lint`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(security): add audit interceptor, coverage check, and SecurityModule`.

### Task 4: Identity Service — close the authorization gaps

**Files:** Delete `organizations/roles.ts` and `roles.test.ts`, repointing their imports to `@rivocloud/security`. Create `organizations/membership.service.ts` and `organizations/org-member.guard.ts`. Modify `organizations/{roles.guard.ts,organizations.controller.ts,organizations.service.ts,organizations.module.ts}`, `api-keys/{api-keys.service.ts,api-keys.controller.ts}`, `auth/{auth-guard.ts,jwt-only.guard.ts}`, `internal/internal.controller.ts`, and the integration tests for organizations, api-keys, internal, and auth-guard.

**Interfaces:**
- Consumes: `scopesAllowedForRole`, `isOrgRole`, `OrgRole`, `ORG_ROLES`, `API_KEY_SCOPES` from Task 1.
- Produces: `MembershipService.currentRole(orgId: string, userId: string): Promise<OrgRole | null>`. `OrgMemberGuard` sets `request.orgRole: OrgRole`. `RolesGuard` reads `request.orgRole`. `POST /internal/auth/verify-api-key` returns `{ orgId, userId, apiKeyId, permissions }`, where permissions are the effective ones. `JwtOnlyGuard` sets `request.auth = { type: 'jwt', userId, orgId, role }`, where `role` is live.

- [ ] **Step 1: Write failing integration tests** (extend the existing files; helpers as in `organizations.controller.integration.test.ts`):
  - `cross-org access returns 404`: the owner of org B calls `GET`/`POST`/`PATCH`/`DELETE /orgs/:orgA/members...` → 404.
  - `members list hides password hashes`: the body has exactly `{ userId, role, joinedAt, user: { id, email, name } }` per member.
  - `nobody can assign the owner role`: `POST` and `PATCH` with `role: 'owner'` → 400.
  - `admin can invite developer but not admin`: 201 / 403.
  - `admin cannot remove another admin` → 403. `only owner can change roles`: admin `PATCH` → 403, owner → 200.
  - `verify-token returns the live role`: issue a token as developer, owner demotes to viewer, then `verify-token` → `role: 'viewer'`.
  - `verify-token rejects a removed member` → 401 `No longer a member of this organization`.
  - `verify-api-key returns apiKeyId and effective permissions`: a developer creates a key with `['zone:read','zone:write']`, gets demoted to viewer → `apiKeyId` equals the key's id and `permissions` equals `['zone:read']`.
  - `api key is invalid after its creator leaves the org` → 401.
  - `developer cannot revoke another member's key` → 403; `admin can` → 200; `developer can revoke own key` → 200.
- [ ] **Step 2:** Run `pnpm --filter @rivocloud/identity-service test:integration`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement per Design Decisions 4–9. Controller guard order is `@UseGuards(JwtOnlyGuard, OrgMemberGuard, RolesGuard)`. `OrgMemberGuard` is a no-op on routes without `:orgId` (`POST /orgs`, `GET /orgs`). Add `@IsIn(['admin','developer','viewer'])` on the member DTOs (replacing `ORG_ROLES`) so `owner` yields a 400. Admin-vs-target checks live in the service, which receives the caller's role.
- [ ] **Step 4:** Run the identity unit and integration suites plus typecheck. Expected: PASS.
- [ ] **Step 5:** Commit `fix(identity): enforce org membership, live roles, and role-capped API keys`.

### Task 5: Identity Service — audit, rate limits, audit-log API

**Files:** Create `audit-logs/{audit-logs.module.ts,audit-logs.controller.ts,audit-logs.service.ts,dto/list-audit-logs.dto.ts,audit-logs.controller.integration.test.ts}`, `security/rate-limit.integration.test.ts`, `audit-coverage.test.ts`. Modify `app.module.ts` (`SecurityModule.forRoot({ redisToken: REDIS, prismaToken: PRISMA, envToken: APP_ENV })` + `AuditLogsModule`), `main.ts` (`configureTrustProxy(app, env.TRUST_PROXY)`), `vitest.integration.config.ts` (`test.env: { RATE_LIMIT_ENABLED: 'false' }`), and every controller (decorators). Check identity's actual Redis/Prisma token names in `redis.module.ts`/`prisma.module.ts` and use those.

**Interfaces:**
- Consumes: Task 3 `Audit`, `NoAudit`, `RateLimit`, `RATE_LIMITS`, `SecurityModule`, `configureTrustProxy`, `findUnauditedMutations`, `SECURITY_OPTIONS`; Task 4 `OrgMemberGuard`, `RolesGuard`, `Roles`.
- Produces: `GET /api/v1/orgs/:orgId/audit-logs?cursor=<id>&limit=<1..100, default 50>` (Owner/Admin) → `{ items: AuditLogEntry[]; nextCursor: string | null }` where `AuditLogEntry = { id: string; action: string; resourceType: string | null; resourceId: string | null; ipAddress: string | null; userAgent: string | null; metadata: unknown; createdAt: string; user: { id: string; email: string; name: string } | null; apiKey: { id: string; name: string; keyPrefix: string } | null }`. Ordered by `id` desc; `cursor` returns rows with `id < cursor`; `nextCursor` is the last item's id when `items.length === limit`.

Audit actions (resourceType in parentheses):
| Route | Decorator |
|---|---|
| `auth/*` (all), `internal/*` | `@NoAudit()` on the class |
| `PATCH users/me` | `user.updated` (user), `bodyFields: ['name','avatarUrl']` |
| `PATCH users/me/password` | `user.password_changed` (user) |
| `DELETE users/me` | `user.deleted` (user) |
| `POST orgs` | `org.created` (organization), `idPath: 'organization.id'`, `orgIdPath: 'organization.id'` |
| `PATCH orgs/:orgId` | `org.updated` (organization), `idParam: 'orgId'`, `bodyFields: ['name']` |
| `DELETE orgs/:orgId` | `org.deleted` (organization), `idParam: 'orgId'`, `detachOrg: true` |
| `POST orgs/:orgId/members` | `member.added` (member), `idPath: 'userId'`, `bodyFields: ['email','role']` |
| `PATCH orgs/:orgId/members/:userId` | `member.role_updated` (member), `idParam: 'userId'`, `bodyFields: ['role']` |
| `DELETE orgs/:orgId/members/:userId` | `member.removed` (member), `idParam: 'userId'` |
| `POST api-keys` | `api_key.created` (api_key), `idPath: 'id'`, `bodyFields: ['name','permissions']` |
| `PATCH api-keys/:keyId` | `api_key.updated` (api_key), `idParam: 'keyId'`, `bodyFields: ['name','permissions']` |
| `DELETE api-keys/:keyId` | `api_key.revoked` (api_key), `idParam: 'keyId'` |

Rate limits: `login` and `register` → `@RateLimit(RATE_LIMITS.auth)`; `forgot-password` → `@RateLimit(RATE_LIMITS.forgotPassword)`.

- [ ] **Step 1: Write failing tests.**
  `audit-coverage.test.ts`: `import.meta.glob('./**/*.controller.ts', { eager: true })`, collect the exported classes, and `expect(findUnauditedMutations(controllers)).toEqual([])`.
  `audit-logs.controller.integration.test.ts`:
  - `inviting a member writes member.added with actor and metadata` (row has `userId` = owner, `orgId`, `metadata.body = { email, role }`)
  - `password change audit row has no password fields` (`JSON.stringify(metadata)` does not contain `currentPassword`, `newPassword`, or either password value)
  - `owner and admin can read; developer gets 403`
  - `audit logs are org-scoped` (org B's owner reading org A → 404)
  - `paginates with cursor` (create 3 entries, `limit=2` → 2 items + `nextCursor`; the next page → 1 item + `nextCursor: null`)
  - `creating an org records the new org id`
  `security/rate-limit.integration.test.ts` (`.overrideProvider(SECURITY_OPTIONS).useValue({ rateLimitEnabled: true })`; `configureTrustProxy(app, 'loopback')`; flush `ratelimit:*` in `beforeEach`):
  - `the 11th login in a minute from one IP gets 429 with Retry-After`
  - `separate X-Forwarded-For clients get separate buckets` (10 logins from `198.51.100.1`, then one from `198.51.100.2` → not 429)
  - `the 6th forgot-password in an hour gets 429`
  - `authenticated requests count against the general bucket` (seed `ratelimit:general:user:<id>` with 1000 fresh members via `ZADD`, then `GET /users/me` → 429)
- [ ] **Step 2:** Run the identity unit and integration suites. Expected: FAIL.
- [ ] **Step 3:** Implement the module, decorators, and wiring above.
- [ ] **Step 4:** Run the identity unit and integration suites, typecheck, and lint. Expected: PASS, with the existing suites still green.
- [ ] **Step 5:** Commit `feat(identity): audit every mutation, rate-limit auth, and expose org audit logs`.

### Task 6: CDN Service — shared guard, audit, rate limits

**Files:** Delete `auth/zone-scope.guard.ts` and its test. Modify `auth/auth.module.ts`, `auth/identity-client.ts` (+ test: `apiKeyId: body.apiKeyId`), `auth/auth-context.decorator.ts` (`CombinedAuthContext` becomes an alias of `SecurityAuthContext`), the zones/rules/invalidations/domains controllers, `signed-urls-internal.controller.ts` (`@NoAudit()`), `app.module.ts`, `main.ts`, and `vitest.integration.config.ts`. Create `audit-coverage.test.ts`. Add `@rivocloud/security` to `package.json`.

**Interfaces — Consumes:** Tasks 1–3. Map each `@RequireZoneScope('read'|'write'|'delete'|'invalidate')` to `@RequireScope('zone:read'|'zone:write'|'zone:delete'|'cache:invalidate')`, and each `@UseGuards(AuthGuard, ZoneScopeGuard)` to `@UseGuards(AuthGuard, ScopeGuard)`.

Audit actions: zones `POST` `zone.created` (`idPath:'id'`), `PATCH :zoneId` `zone.updated` (`idParam:'zoneId'`, `bodyFields` = the `UpdateZoneDto` property names), `POST :zoneId/signing-secret/rotate` `zone.signing_secret_rotated`, `DELETE :zoneId` `zone.deleted`. Rules (resourceType `cache_rule`): `POST` `cache_rule.created` (`idPath:'id'`), `PATCH :ruleId` `cache_rule.updated`, `DELETE :ruleId` `cache_rule.deleted`, `POST reorder` `cache_rule.reordered` (resourceType `zone`, `idParam:'zoneId'`). Invalidations (resourceType `zone`, `idParam:'zoneId'`): `POST invalidate` `cache.invalidated` (`bodyFields` = the `CreateInvalidationDto` property names), `POST purge` `cache.purged`. Domains (resourceType `domain`): `POST` `domain.created` (`idPath:'id'`, `bodyFields:['hostname']` if that is the DTO field name), `DELETE :domainId` `domain.deleted`, `POST :domainId/verify` `domain.verification_requested`. The `invalidate` and `purge` handlers get `@RateLimit(RATE_LIMITS.cacheInvalidation)`.

- [ ] **Step 1: Write failing tests.** `audit-coverage.test.ts` as in Task 5. In `zones.controller.integration.test.ts`: `viewer JWT cannot create a zone` (403) and `creating a zone writes zone.created` (row with `resourceId` = new zone id). In `invalidations.controller.integration.test.ts` (rate limiting enabled via override, `ratelimit:*` flushed): `the 101st invalidation for one zone in a minute gets 429`, using `ZADD` to seed 100 entries rather than 100 HTTP calls. Update `identity-client.test.ts` to expect `apiKeyId`.
- [ ] **Step 2:** Run `pnpm --filter @rivocloud/cdn-service test:unit test:integration`. Expected: FAIL.
- [ ] **Step 3:** Implement. `SecurityModule.forRoot({ redisToken: REDIS, prismaToken: PRISMA, envToken: APP_ENV })`; `configureTrustProxy` in `main.ts`; `RATE_LIMIT_ENABLED: 'false'` in the integration config.
- [ ] **Step 4:** Run the suites, typecheck, and lint. Expected: PASS.
- [ ] **Step 5:** Commit `feat(cdn-service): adopt shared ScopeGuard, audit zone mutations, rate-limit invalidation`.

### Task 7: Storage Service — shared guard, audit, rate limits

**Files:** Delete `auth/storage-scope.guard.ts` and its test. Create `redis/redis.module.ts` (copy of cdn-service's, token `REDIS`) and `audit-coverage.test.ts`. Modify `auth/{auth.module.ts,identity-client.ts,identity-client.test.ts,auth-context.decorator.ts}`, the buckets/objects controllers, `minio-webhook.controller.ts` (`@NoAudit()`), `app.module.ts` (+ `RedisModule`, `SecurityModule.forRoot`), `main.ts`, `vitest.integration.config.ts`, and `package.json` (+ `@rivocloud/security`, `ioredis`).

**Interfaces — Consumes:** Tasks 1–3. Map `@RequireStorageScope('read'|'write'|'delete')` to `@RequireScope('storage:read'|'storage:write'|'storage:delete')`.

Audit actions: buckets (resourceType `bucket`) `POST` `bucket.created` (`idPath:'id'`), `PATCH :bucketId` `bucket.updated` (`idParam:'bucketId'`), `DELETE :bucketId` `bucket.deleted`. Objects (resourceType `object`, `idParam:'key'`; `bucketId` arrives through `metadata.params`): `POST upload` `object.upload_initiated` (resourceType `bucket`, `idParam:'bucketId'`, `bodyFields` = the key/content-type fields of `InitiateUploadDto`), `POST :key/sign` `object.signed_url_created` (`bodyFields:['zoneId','expiresIn']`), `DELETE :key` `object.deleted`.

- [ ] **Step 1: Write failing tests.** Coverage test. `buckets.controller.integration.test.ts`: `viewer JWT cannot create a bucket` (403) and `deleting a bucket writes bucket.deleted`.
- [ ] **Step 2:** Run `pnpm --filter @rivocloud/storage-service test:unit test:integration`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites, typecheck, and lint. Expected: PASS.
- [ ] **Step 5:** Commit `feat(storage-service): adopt shared ScopeGuard, audit bucket and object mutations`.

### Task 8: Analytics Service — `analytics:read`, analytics rate limit

**Files:** Delete `auth/analytics-access.guard.ts` and its test. Create `redis/redis.module.ts` and `audit-coverage.test.ts`. Modify `auth/{auth.module.ts,identity-client.ts,identity-client.test.ts,auth-context.decorator.ts}`, `analytics/analytics.controller.ts` (`@UseGuards(AuthGuard, ScopeGuard)`, class-level `@RequireScope('analytics:read')` and `@RateLimit(RATE_LIMITS.analytics)`), `ingestion/events-internal.controller.ts` (`@NoAudit()`), `app.module.ts`, `main.ts`, `vitest.integration.config.ts`, and `package.json`.

- [ ] **Step 1: Write failing tests** in `analytics.controller.integration.test.ts`: `api key with only zone:read is denied` (403), `api key with analytics:read is allowed`, `viewer JWT is allowed`, and, with rate limiting enabled, `the 61st request in a minute gets 429` (seed via `ZADD`). Plus the coverage test.
- [ ] **Step 2:** Run `pnpm --filter @rivocloud/analytics-service test:unit test:integration`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites, typecheck, and lint. Expected: PASS.
- [ ] **Step 5:** Commit `feat(analytics-service): require analytics:read and rate-limit analytics queries`.

### Task 9: Dashboard — client IP forwarding and Settings page

**Files:** Create `lib/forwarded-headers.ts`, `lib/rbac.ts`, `lib/rbac.test.ts`, the five proxy route files listed in File Structure, `hooks/use-members.ts`, `hooks/use-api-keys.ts`, `hooks/use-audit-logs.ts`, `components/settings/{members-panel,api-keys-panel,audit-log-panel}.tsx` with a `.test.tsx` each, and `app/(app)/settings/page.tsx`. Modify `lib/proxy.ts` (+ `proxy.test.ts`), `lib/types.ts`, `app/api/auth/login/route.ts`, `app/api/auth/register/route.ts`, `app/api/me/route.ts`, `hooks/use-me.ts`, and `components/layout/app-shell.tsx` (nav item `{ href: '/settings', label: 'Settings' }`).

**Interfaces:**
- Consumes: Task 4 member shape, Task 5 audit-log shape, existing identity API-key endpoints (`GET/POST /api/v1/api-keys`, `PATCH/DELETE /api/v1/api-keys/:keyId`; create returns `{ id, name, keyPrefix, permissions, rawKey }`).
- Produces: `clientForwardHeaders(): Promise<Record<string, string>>` (from `next/headers`: `X-Forwarded-For` and `User-Agent` when present on the incoming request). `proxyToBackend` merges these under any caller-supplied headers, and login/register pass them to `backendFetch`. `/api/me` adds `role: string | null` (decoded from the session's access token). Types: `OrgRole`, `OrgMember`, `ApiKey`, `CreatedApiKey`, `AuditLogEntry`, `AuditLogPage`. `lib/rbac.ts`: `API_KEY_SCOPES`, `scopesAllowedForRole(role)`, `canManageMembers(role)` (owner/admin), `canChangeRoles(role)` (owner), `canViewAuditLog(role)` (owner/admin), with comments pointing at the package as the source of truth.
- Hooks: `useMembers(orgId)`, `useAddMember(orgId)`, `useUpdateMemberRole(orgId)`, `useRemoveMember(orgId)` (query key `['members', orgId]`); `useApiKeys()`, `useCreateApiKey()`, `useRevokeApiKey()` (key `['api-keys']`); `useAuditLogs(orgId)` as `useInfiniteQuery` (key `['audit-logs', orgId]`, `getNextPageParam: p => p.nextCursor ?? undefined`).

Page: `/settings` shows tabs "Members", "API keys", and "Audit log" (the last only when `canViewAuditLog(me.role)`), using the existing `Card`/`Table`/`Button`/`Dialog`/`Input` UI components. Members: a table of name, email, role, and joined date. Owner/admin see the invite form, with role options `admin,developer,viewer` for the owner and `developer,viewer` for an admin. The owner gets a role `<select>` on non-owner rows. Remove buttons appear where Decision 7 allows. API keys: a table of name, `keyPrefix…`, scopes, and last used. A "Create key" dialog has a name field and checkboxes for `scopesAllowedForRole(me.role)`. After it succeeds, the dialog shows `rawKey` once with a Copy button and the text "This key will not be shown again." Revoke has a confirm step. Audit log: a table of time, actor (user email, else `API key <keyPrefix>`, else `System`), action, resource (`resourceType` + `resourceId`), and IP, with a "Load more" button while `hasNextPage`.

- [ ] **Step 1: Write failing tests.**
  - `proxy.test.ts`: `forwards x-forwarded-for and user-agent` (mock `next/headers`, then assert the `fetch` init headers).
  - `rbac.test.ts`: `matches the security package` (import `../../../../packages/security/src/rbac/scopes.ts` and compare `API_KEY_SCOPES` and each role's scopes).
  - `members-panel.test.tsx`: `viewer sees no invite form`; `owner invites a member` (POSTs `{ email, role }` to `/api/orgs/<orgId>/members`); `admin's role options exclude admin`.
  - `api-keys-panel.test.tsx`: `developer cannot pick billing:read`; `shows the raw key once after creation`.
  - `audit-log-panel.test.tsx`: `renders actor, action, and resource`; `load more requests the next cursor` (second fetch URL contains `cursor=<id>`).
- [ ] **Step 2:** Run `pnpm --filter @rivocloud/dashboard test:unit`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @rivocloud/dashboard test:unit typecheck lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(dashboard): add Settings page for members, API keys, and audit log`.

### Task 10: Docs and full verification

**Files:** Modify `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md` and `docs/concepts/security-rbac-and-audit-logging.md`.

- [ ] **Step 1:** PRD: Stage 11 row → `✅ Done`; correct the header **Status** line to "Stages 1–11 complete, Stages 12–16 not started".
- [ ] **Step 2:** Concept doc: replace the "has not been built yet" banner with an as-built summary covering the shared package, live roles, `analytics:read`, member/API-key rules, the audited routes and the awaited-but-non-fatal write, rate-limit policies and fail-open, `TRUST_PROXY`, and the non-goals list.
- [ ] **Step 3:** Run `pnpm turbo lint typecheck test:unit` and `pnpm test:integration` (Docker infra up via `scripts/dev.sh`). Expected: all green. Paste the summary lines into the commit body.
- [ ] **Step 4:** Commit `docs: mark Stage 11 done and record the as-built security design`.
