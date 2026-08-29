# Phase 1 — Stage 7: NATS Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every zone on-demand cache invalidation (purge by path pattern or tag, reflected across every Edge Proxy within seconds via NATS) and a per-path cache rules engine (per-pattern TTL override, bypass, and query-string normalization), matching the PRD's Stage 7 roadmap row exactly: "NATS Invalidation — cache invalidation + cache rules engine."

**Architecture:** The CDN Service (NestJS) gains two new REST surfaces backed by the already-existing `CacheRule`/`CacheInvalidation` Prisma tables: a `rules` module (CRUD + reorder, publishing the zone's rules to Redis as `zone_rules:{zoneId}` on every change) and an `invalidations` module (`POST .../cache/invalidate`, `POST .../cache/purge`, plus history endpoints). Invalidation uses a NATS **scatter-gather**: publish once to `cache.invalidate.{zoneId}` with a reply inbox, collect however many Edge Proxy replies arrive within 5 seconds, then mark the invalidation `completed` — this requires a new `EventsService.requestMany` method alongside the existing fire-and-forget `publish`. The Go Edge Proxy subscribes to `cache.invalidate.*`, purges matching entries from its L1 (in-process LRU) and L2 (Redis) caches by scanning stored entries for a `(zoneId, path)` match (glob) or tag match, and replies with how many keys it purged. Cache rules reach the Edge Proxy the same way zone config already does — a `zone_rules:{zoneId}` Redis key, refreshed on the same `config.zones.updated` NATS event the registry already subscribes to — and are evaluated once per request to override the origin-header TTL priority chain (EDD §5.3, Priority 1) and to pick the cache key's query-string normalization mode.

**Tech Stack:** NestJS 10, `@rivocloud/db` (Prisma, no migration needed — both tables exist since Stage 1), `ioredis`, `nats` (Node client) / `github.com/nats-io/nats.go` (Go, already a dependency), `class-validator`/`class-transformer`, Vitest, Go stdlib.

**Spec:**
- [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.5 (Cache Management), Section 7 (Roadmap, Stage 7)
- [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 4.4 (Cache Invalidation Flow), Section 5.2 (Cache Key Design), Section 5.3 (TTL priority), Section 6.2 (`cache_rules`/`cache_invalidations` schema), Section 7.5 (API), Section 11.7 (development order)
- [`docs/concepts/cache-invalidation-and-messaging.md`](../../concepts/cache-invalidation-and-messaging.md) — the beginner walkthrough this plan implements end-to-end

## Global Constraints

- API routes are versioned `/api/v1/...`.
- Every resource is org-scoped; a caller only ever sees rules/invalidations belonging to zones owned by their own `orgId`.
- The Edge Proxy never queries PostgreSQL and never calls the CDN Service's HTTP API on the hot path — Redis and NATS are the only hand-off points.
- Redis is the authoritative config source; NATS is a faster-than-TTL nudge, not a required delivery path — a missed NATS message must never break correctness, only latency-of-propagation. This does **not** apply to the invalidation subject itself (`cache.invalidate.{zoneId}`), which has no Redis fallback — it is the delivery mechanism, matching the EDD.
- This dev machine has no native Go toolchain — every Go command runs through `bash apps/edge-proxy/scripts/go-docker.sh <cmd>` (already wired into `pnpm --filter @rivocloud/edge-proxy test:unit`/`test:integration`).
- No dashboard UI in this stage — the PRD's roadmap table lists Stage 7 as "cache invalidation + cache rules engine" only; a rules/invalidation UI is not part of this row.

## Design Decisions (read before starting)

These resolve ambiguity the source docs leave open. Each is a deliberate, scoped choice — not a placeholder:

1. **Tag-based purge needs a tagging mechanism, which doesn't exist yet.** The concept doc explicitly flags "the exact mechanism ... is an implementation detail for whoever builds Stage 7." This plan adds the minimal version: an origin response header `Cache-Tag: tag1,tag2` (comma-separated), read at cache-write time into a new `cachestore.Entry.Tags` field. An origin that never sends this header simply never gets tag-based purging (a safe no-op, not a bug) — pattern-based invalidation, the primary and fully-specified mechanism, always works regardless.
2. **Cache keys are opaque SHA-256 hashes with no recoverable path** (`cachekey.Build`), so purge-by-pattern can't glob-match the key itself. `cachestore.Entry` gains `ZoneID` and `Path` fields, populated at write time, so a purge operation can fetch-then-filter: exactly what the EDD's own flow diagram specifies ("SCAN Redis for matching keys → delete"), not a new secondary index.
3. **NATS scatter-gather, not `nc.Request`.** `nc.Request`/`connection.request` collects exactly one reply. Collecting a variable number of Edge Proxy replies within a window needs a manually-managed reply-inbox subscription: publish with `reply: inbox`, then read the inbox's async iterator until a timer calls `sub.unsubscribe()` — at which point the iterator completes cleanly (no error). This is the standard NATS "scatter-gather" pattern.
4. **`invalidate` is a new `ZoneAction`, mapped to the `cache:invalidate` API-key scope** (already present in `apps/identity-service/src/organizations/roles.ts`'s `API_KEY_SCOPES`, granted to owner/admin/developer, withheld from viewer) — not `zone:write`. `ZoneScopeGuard`'s API-key branch currently hardcodes `` `zone:${action}` ``; this plan changes it to a per-action scope-string lookup table so `invalidate` can map to a differently-prefixed scope without breaking `read`/`write`/`delete`.
5. **A matched cache rule overrides the origin-header TTL priority chain outright, not as a clamp** (EDD §5.3: "There is no separate 'RivoCloud edge TTL override' distinct from cache rules"). A `bypass`/`no-store` rule routes the request through the existing `proxyUncached` path unchanged (skip the cache entirely, exactly what "bypass" means) instead of adding a parallel non-caching code path. A `cache` rule with `edgeTtl` set replaces `httpcache.Decide`'s computed TTL after the fact.
6. **Rule-level `browserTtl` overrides the browser `Cache-Control: max-age`** independent of edge TTL, by storing an optional `BrowserTTL *time.Duration` on `cachestore.Entry`. Zone-level `browser_ttl` (the `pull_zones.browser_ttl` column) is **not** wired up anywhere in the codebase today (a pre-existing gap from Stages 3/4, confirmed by reading `handler.go`/`zone.Config` — there is no `Config.BrowserTTL` field at all) and fixing that is out of Stage 7's scope; this plan only adds the rule-level override the EDD explicitly requires for `cache_rules.browser_ttl`.
7. **`query_string` normalization mode only changes behavior when a rule matches.** With no matching rule, cache-key construction keeps today's existing behavior (sort and include every query parameter — functionally `include_all`), so no existing Stage 3 traffic changes shape. `cachekey.Build` gains two new parameters (`queryMode string, whitelist []string`); all five existing call sites are updated to pass `"include_all", nil` to preserve current behavior exactly, except where a rule match provides a different mode.
8. **Reordering rules (`POST .../rules/reorder`) takes an explicit ordered list of rule IDs** (`{ order: string[] }`, highest priority first) and assigns `priority = len(order) - 1 - index`, rejecting a list that doesn't exactly match the zone's existing rule IDs.
9. **No new shared package** for the rules/invalidations modules — following Stage 4's Decision 1, each new service file queries zone ownership itself (`db.pullZone.findUnique` + `orgId` check) rather than extracting a shared helper for two call sites.

## File Structure

```
apps/cdn-service/src/
  auth/zone-scope.guard.ts               # modified: 'invalidate' action, scope-by-action map
  auth/zone-scope.guard.test.ts          # modified: new action's tests
  events/events.service.ts               # modified: + requestMany()
  events/events.service.requestMany.integration.test.ts   # new
  rules/
    dto/create-rule.dto.ts, update-rule.dto.ts, reorder-rules.dto.ts, list-rules.dto.ts
    rules-config.publisher.ts
    rules-config.publisher.integration.test.ts
    rules.service.ts
    rules.service.integration.test.ts
    rules.controller.ts
    rules.controller.integration.test.ts
    rules.module.ts
  invalidations/
    dto/create-invalidation.dto.ts, list-invalidations.dto.ts
    invalidations.service.ts
    invalidations.service.integration.test.ts
    invalidations.controller.ts
    invalidations.controller.integration.test.ts
    invalidations.module.ts
  app.module.ts                           # modified: + RulesModule, InvalidationsModule

apps/edge-proxy/
  internal/globmatch/globmatch.go, globmatch_test.go             # new
  internal/cacherules/cacherules.go, cacherules_test.go           # new
  internal/cachekey/cachekey.go                                    # modified: query modes
  internal/cachekey/cachekey_test.go                               # modified: new signature
  internal/cachestore/entry.go                                     # modified: ZoneID/Path/Tags/BrowserTTL
  internal/cachestore/layer.go                                     # modified: + Purge
  internal/cachestore/memory.go, memory_test.go                    # modified: + Purge
  internal/cachestore/redis.go, redis_integration_test.go          # modified: + Purge
  internal/zone/zone.go                                            # modified: Config.Rules
  internal/zone/redis_registry.go, redis_registry_integration_test.go   # modified: read zone_rules:{id}
  internal/invalidation/subscriber.go, subscriber_integration_test.go   # new
  internal/proxy/handler.go                                        # modified: rule-aware key/TTL/tags
  internal/proxy/handler_cacherules_integration_test.go            # new
  cmd/edge-proxy/main.go                                           # modified: wire invalidation.Subscribe
```

---

### Task 1: `ZoneScopeGuard` gains an `invalidate` action

**Files:**
- Modify: `apps/cdn-service/src/auth/zone-scope.guard.ts`
- Modify: `apps/cdn-service/src/auth/zone-scope.guard.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ZoneAction = 'read' | 'write' | 'delete' | 'invalidate'`; `@RequireZoneScope('invalidate')` usable by later tasks' controllers.

- [ ] **Step 1: Write the failing tests**

Add to `apps/cdn-service/src/auth/zone-scope.guard.test.ts` (open the file first to match its existing `describe`/mock-context style, then add):

```ts
it('allows a developer role to invalidate', () => {
  const guard = new ZoneScopeGuard(reflectorReturning('invalidate'));
  const context = contextWithAuth({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'developer' });
  expect(guard.canActivate(context)).toBe(true);
});

it('rejects a viewer role trying to invalidate', () => {
  const guard = new ZoneScopeGuard(reflectorReturning('invalidate'));
  const context = contextWithAuth({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' });
  expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
});

it('requires the cache:invalidate scope (not zone:invalidate) for an API key', () => {
  const guard = new ZoneScopeGuard(reflectorReturning('invalidate'));
  const context = contextWithAuth({ type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['zone:read'] });
  expect(() => guard.canActivate(context)).toThrow('cache:invalidate');
});

it('allows an API key with the cache:invalidate scope', () => {
  const guard = new ZoneScopeGuard(reflectorReturning('invalidate'));
  const context = contextWithAuth({ type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['cache:invalidate'] });
  expect(guard.canActivate(context)).toBe(true);
});
```

(Use whatever `reflectorReturning`/`contextWithAuth` helpers the existing file already defines for its `read`/`write`/`delete` tests — mirror their shape exactly.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rivocloud/cdn-service test:unit -- zone-scope.guard`
Expected: FAIL — `'invalidate'` is not assignable to `ZoneAction`, and the scope string doesn't match.

- [ ] **Step 3: Implement**

In `apps/cdn-service/src/auth/zone-scope.guard.ts`, replace the type, the roles map, and the API-key branch:

```ts
export type ZoneAction = 'read' | 'write' | 'delete' | 'invalidate';

// Mirrors apps/identity-service/src/organizations/roles.ts's API_KEY_SCOPES /
// scopesAllowedForRole. Duplicated rather than imported across the service
// boundary (see the Stage 4 plan's Design Decisions #1/#6) — keep these two
// in sync by hand until a third consumer justifies a shared package.
const ROLES_BY_ACTION: Record<ZoneAction, string[]> = {
  read: ['owner', 'admin', 'developer', 'viewer'],
  write: ['owner', 'admin', 'developer'],
  delete: ['owner', 'admin', 'developer'],
  invalidate: ['owner', 'admin', 'developer'],
};

// zone:read/write/delete share their action name as the scope suffix, but
// cache invalidation uses the identity-service's own cache:invalidate scope
// (not zone:invalidate, which doesn't exist in API_KEY_SCOPES) — this map
// lets each action name diverge from its scope string independently.
const SCOPE_BY_ACTION: Record<ZoneAction, string> = {
  read: 'zone:read',
  write: 'zone:write',
  delete: 'zone:delete',
  invalidate: 'cache:invalidate',
};
```

And in `canActivate`, replace the api_key branch's scope computation:

```ts
    if (auth.type === 'api_key') {
      const required = SCOPE_BY_ACTION[action];
      if (!auth.permissions?.includes(required)) {
        throw new ForbiddenException(`API key is missing the "${required}" scope`);
      }
      return true;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rivocloud/cdn-service test:unit -- zone-scope.guard`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add apps/cdn-service/src/auth/zone-scope.guard.ts apps/cdn-service/src/auth/zone-scope.guard.test.ts
git commit -m "feat(cdn-service): add invalidate zone action mapped to cache:invalidate scope"
```

---

### Task 2: `EventsService.requestMany` — NATS scatter-gather

**Files:**
- Modify: `apps/cdn-service/src/events/events.service.ts`
- Test: `apps/cdn-service/src/events/events.service.requestMany.integration.test.ts`

**Interfaces:**
- Consumes: existing `EventsService` constructor (`natsUrl: string`), `nats` package's `connect`, `JSONCodec`.
- Produces: `EventsService.requestMany<T>(subject: string, payload: unknown, timeoutMs: number): Promise<T[]>` — publishes once with a reply inbox, collects every reply received before `timeoutMs` elapses, returns them (order not guaranteed). Returns `[]` immediately if NATS is unavailable (mirrors `publish`'s existing best-effort behavior).

- [ ] **Step 1: Write the failing integration test**

Create `apps/cdn-service/src/events/events.service.requestMany.integration.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { connect, type NatsConnection } from 'nats';
import { EventsService } from './events.service.js';

const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222';

describe('EventsService.requestMany', () => {
  let responders: NatsConnection[] = [];

  afterEach(async () => {
    await Promise.all(responders.map((nc) => nc.close()));
    responders = [];
  });

  async function startResponder(subject: string, reply: unknown): Promise<void> {
    const nc = await connect({ servers: natsUrl });
    responders.push(nc);
    const sub = nc.subscribe(subject);
    (async () => {
      for await (const msg of sub) {
        if (msg.reply) {
          nc.publish(msg.reply, new TextEncoder().encode(JSON.stringify(reply)));
        }
      }
    })();
  }

  it('collects replies from every responder within the timeout window', async () => {
    const subject = `cache.invalidate.test-${Date.now()}`;
    await startResponder(subject, { datacenter: 'a', keysPurged: 3 });
    await startResponder(subject, { datacenter: 'b', keysPurged: 5 });

    const events = new EventsService(natsUrl);
    const replies = await events.requestMany<{ datacenter: string; keysPurged: number }>(
      subject,
      { zoneId: 'z1' },
      1000,
    );

    expect(replies).toHaveLength(2);
    expect(replies.map((r) => r.keysPurged).sort()).toEqual([3, 5]);
  });

  it('returns an empty array when nobody replies before the timeout', async () => {
    const events = new EventsService(natsUrl);
    const replies = await events.requestMany('cache.invalidate.nobody-listening', { zoneId: 'z2' }, 300);
    expect(replies).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- requestMany`
Expected: FAIL with "requestMany is not a function".

- [ ] **Step 3: Implement `requestMany`**

In `apps/cdn-service/src/events/events.service.ts`, add the import and method:

```ts
import { connect, createInbox, JSONCodec, type NatsConnection } from 'nats';
```

```ts
  // Scatter-gather: publish once with a reply inbox, then collect however
  // many replies arrive before timeoutMs. Unlike nc.request() (exactly one
  // reply), invalidation needs replies from an unknown number of Edge
  // Proxies (EDD Section 4.4, Step 4: "Wait 5 seconds for replies from all
  // known edge nodes"). sub.unsubscribe() ends the subscription's async
  // iterator cleanly (no error) once the timer fires, so the for-await loop
  // below simply completes rather than throwing.
  async requestMany<T>(subject: string, payload: unknown, timeoutMs: number): Promise<T[]> {
    const connection = await this.getConnection();
    if (!connection) {
      return [];
    }
    const inbox = createInbox();
    const sub = connection.subscribe(inbox);
    connection.publish(subject, this.codec.encode(payload), { reply: inbox });

    const replies: T[] = [];
    const timer = setTimeout(() => sub.unsubscribe(), timeoutMs);
    for await (const msg of sub) {
      replies.push(this.codec.decode(msg.data) as T);
    }
    clearTimeout(timer);
    return replies;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- requestMany`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cdn-service/src/events/events.service.ts apps/cdn-service/src/events/events.service.requestMany.integration.test.ts
git commit -m "feat(cdn-service): add EventsService.requestMany NATS scatter-gather"
```

---

### Task 3: Cache Rules module — DTOs, service, publisher, controller

**Files:**
- Create: `apps/cdn-service/src/rules/dto/create-rule.dto.ts`, `dto/update-rule.dto.ts`, `dto/reorder-rules.dto.ts`, `dto/list-rules.dto.ts`
- Create: `apps/cdn-service/src/rules/rules-config.publisher.ts`
- Test: `apps/cdn-service/src/rules/rules-config.publisher.integration.test.ts`
- Create: `apps/cdn-service/src/rules/rules.service.ts`
- Test: `apps/cdn-service/src/rules/rules.service.integration.test.ts`
- Create: `apps/cdn-service/src/rules/rules.controller.ts`
- Test: `apps/cdn-service/src/rules/rules.controller.integration.test.ts`
- Create: `apps/cdn-service/src/rules/rules.module.ts`
- Modify: `apps/cdn-service/src/app.module.ts`

**Interfaces:**
- Consumes: `PRISMA` token, `PullZone`/`CacheRule` from `@rivocloud/db`, `REDIS` token, `EventsService`, `AuthGuard`/`ZoneScopeGuard`/`RequireZoneScope`/`AuthCtx`/`CombinedAuthContext` (all existing, from `../auth/*`).
- Produces: `POST/GET /api/v1/zones/:zoneId/rules`, `PATCH/DELETE /api/v1/zones/:zoneId/rules/:ruleId`, `POST /api/v1/zones/:zoneId/rules/reorder`. `RulesConfigPublisher.publish(zoneId: string): Promise<void>` — writes `zone_rules:{zoneId}` to Redis and fires `config.zones.updated`, used by Task 11 (Edge Proxy) and re-used by the Invalidations task only insofar as both write to the same zone-config-refresh channel.

- [ ] **Step 1: Write the DTOs (no test — pure declarative validation, exercised by the controller integration tests in Step 8)**

`apps/cdn-service/src/rules/dto/create-rule.dto.ts`:

```ts
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Min, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateCacheRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  pattern!: string;

  @IsOptional()
  @IsIn(['glob', 'regex', 'exact'])
  patternType?: string;

  @IsOptional()
  @IsIn(['cache', 'bypass', 'no-store'])
  action?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  edgeTtl?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  browserTtl?: number;

  @IsOptional()
  @IsIn(['strip_all', 'whitelist', 'include_all'])
  queryString?: string;

  @ValidateIf((o) => o.queryString === 'whitelist')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  queryWhitelist?: string[];

  @IsOptional()
  @IsInt()
  priority?: number;
}
```

`apps/cdn-service/src/rules/dto/update-rule.dto.ts`:

```ts
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Min, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateCacheRuleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) pattern?: string;
  @IsOptional() @IsIn(['glob', 'regex', 'exact']) patternType?: string;
  @IsOptional() @IsIn(['cache', 'bypass', 'no-store']) action?: string;
  @IsOptional() @IsInt() @Min(0) edgeTtl?: number;
  @IsOptional() @IsInt() @Min(0) browserTtl?: number;
  @IsOptional() @IsIn(['strip_all', 'whitelist', 'include_all']) queryString?: string;

  @ValidateIf((o) => o.queryString === 'whitelist')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  queryWhitelist?: string[];

  @IsOptional() @IsInt() priority?: number;
}
```

`apps/cdn-service/src/rules/dto/reorder-rules.dto.ts`:

```ts
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderRulesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  order!: string[];
}
```

`apps/cdn-service/src/rules/dto/list-rules.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListRulesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}
```

- [ ] **Step 2: Write the failing `RulesConfigPublisher` integration test**

Create `apps/cdn-service/src/rules/rules-config.publisher.integration.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { EventsService } from '../events/events.service.js';
import { RulesConfigPublisher } from './rules-config.publisher.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const publisher = new RulesConfigPublisher(redis, prisma, events);

async function seedZone() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  return prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: 'my-blog', originUrl: 'https://api.example.com' },
  });
}

describe('RulesConfigPublisher', () => {
  beforeEach(async () => {
    await prisma.cacheRule.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('writes zone_rules:{id} sorted by priority descending', async () => {
    const zone = await seedZone();
    await prisma.cacheRule.create({ data: { zoneId: zone.id, pattern: '/assets/*', priority: 1 } });
    await prisma.cacheRule.create({ data: { zoneId: zone.id, pattern: '/api/*', action: 'bypass', edgeTtl: 0, priority: 10 } });

    await publisher.publish(zone.id);

    const raw = await redis.get(`zone_rules:${zone.id}`);
    const rules = JSON.parse(raw ?? '[]');
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ pattern: '/api/*', action: 'bypass', priority: 10 });
    expect(rules[1]).toMatchObject({ pattern: '/assets/*', priority: 1 });
  });

  it('publishes a config.zones.updated NATS event carrying the zoneId', async () => {
    const zone = await seedZone();
    await publisher.publish(zone.id);
    expect(events.getLastPublished('config.zones.updated')).toEqual({ zoneId: zone.id });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- rules-config.publisher`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `RulesConfigPublisher`**

Create `apps/cdn-service/src/rules/rules-config.publisher.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@rivocloud/db';
import { REDIS } from '../redis/redis.module.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { EventsService } from '../events/events.service.js';

@Injectable()
export class RulesConfigPublisher {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly events: EventsService,
  ) {}

  // Re-fires the same config.zones.updated event the Edge Proxy's
  // configsync subscriber already evicts a zone's cached config on
  // (apps/edge-proxy/internal/configsync/subscriber.go) — no new NATS
  // subject needed for rules to reach the Edge Proxy.
  async publish(zoneId: string): Promise<void> {
    const rules = await this.db.cacheRule.findMany({ where: { zoneId }, orderBy: { priority: 'desc' } });
    const payload = rules.map((r) => ({
      pattern: r.pattern,
      patternType: r.patternType,
      action: r.action,
      edgeTtl: r.edgeTtl,
      browserTtl: r.browserTtl,
      queryString: r.queryString,
      queryWhitelist: r.queryWhitelist,
      priority: r.priority,
    }));
    await this.redis.set(`zone_rules:${zoneId}`, JSON.stringify(payload));
    await this.events.publish('config.zones.updated', { zoneId });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- rules-config.publisher`
Expected: PASS.

- [ ] **Step 6: Write the failing `RulesService` integration test**

Create `apps/cdn-service/src/rules/rules.service.integration.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { RulesConfigPublisher } from './rules-config.publisher.js';
import { RulesService } from './rules.service.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const publisher = new RulesConfigPublisher(redis, prisma, events);
const service = new RulesService(prisma, publisher);

async function seedZone(orgId?: string) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = orgId
    ? { id: orgId }
    : await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  const zone = await prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
  });
  return { org, zone };
}

describe('RulesService', () => {
  beforeEach(async () => {
    await prisma.cacheRule.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a rule scoped to the owning org and publishes it', async () => {
    const { org, zone } = await seedZone();
    const rule = await service.create(org.id, zone.id, { pattern: '/api/*', action: 'bypass', edgeTtl: 0 });
    expect(rule.pattern).toBe('/api/*');
    const raw = await redis.get(`zone_rules:${zone.id}`);
    expect(JSON.parse(raw ?? '[]')).toHaveLength(1);
  });

  it('rejects creating a rule for a zone owned by a different org', async () => {
    const { zone } = await seedZone();
    await expect(service.create('someone-elses-org', zone.id, { pattern: '/x' })).rejects.toThrow(NotFoundException);
  });

  it('requires queryWhitelist when queryString is whitelist', async () => {
    const { org, zone } = await seedZone();
    // Service-level guard mirrors the DTO's ValidateIf, in case a caller
    // bypasses HTTP validation in a test or a future internal caller.
    await expect(
      service.create(org.id, zone.id, { pattern: '/search', queryString: 'whitelist' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('reorders rules by an explicit id list and republishes', async () => {
    const { org, zone } = await seedZone();
    const a = await service.create(org.id, zone.id, { pattern: '/a' });
    const b = await service.create(org.id, zone.id, { pattern: '/b' });

    const reordered = await service.reorder(org.id, zone.id, [b.id, a.id]);
    expect(reordered.rules.find((r) => r.id === b.id)?.priority).toBeGreaterThan(
      reordered.rules.find((r) => r.id === a.id)?.priority ?? Infinity,
    );
  });

  it('rejects reorder with an id list that does not match the zone', async () => {
    const { org, zone } = await seedZone();
    await service.create(org.id, zone.id, { pattern: '/a' });
    await expect(service.reorder(org.id, zone.id, [randomUUID()])).rejects.toThrow(BadRequestException);
  });

  it('deletes a rule and republishes the remaining set', async () => {
    const { org, zone } = await seedZone();
    const rule = await service.create(org.id, zone.id, { pattern: '/a' });
    await service.remove(org.id, zone.id, rule.id);
    const raw = await redis.get(`zone_rules:${zone.id}`);
    expect(JSON.parse(raw ?? '[]')).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- rules.service`
Expected: FAIL — module doesn't exist.

- [ ] **Step 8: Implement `RulesService`**

Create `apps/cdn-service/src/rules/rules.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CacheRule, PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { RulesConfigPublisher } from './rules-config.publisher.js';
import type { CreateCacheRuleDto } from './dto/create-rule.dto.js';
import type { UpdateCacheRuleDto } from './dto/update-rule.dto.js';

@Injectable()
export class RulesService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly publisher: RulesConfigPublisher,
  ) {}

  async create(orgId: string, zoneId: string, dto: CreateCacheRuleDto): Promise<CacheRule> {
    await this.findOwnedZone(orgId, zoneId);
    this.assertQueryWhitelistPresence(dto.queryString, dto.queryWhitelist);
    const rule = await this.db.cacheRule.create({
      data: {
        zoneId,
        pattern: dto.pattern,
        patternType: dto.patternType ?? 'glob',
        action: dto.action ?? 'cache',
        edgeTtl: dto.edgeTtl,
        browserTtl: dto.browserTtl,
        queryString: dto.queryString ?? 'strip_all',
        queryWhitelist: dto.queryWhitelist ?? [],
        priority: dto.priority ?? 0,
      },
    });
    await this.publisher.publish(zoneId);
    return rule;
  }

  async list(orgId: string, zoneId: string, skip: number, take: number) {
    await this.findOwnedZone(orgId, zoneId);
    const [rules, total] = await Promise.all([
      this.db.cacheRule.findMany({ where: { zoneId }, skip, take, orderBy: { priority: 'desc' } }),
      this.db.cacheRule.count({ where: { zoneId } }),
    ]);
    return { rules, total };
  }

  async update(orgId: string, zoneId: string, ruleId: string, dto: UpdateCacheRuleDto): Promise<CacheRule> {
    await this.findOwnedRule(orgId, zoneId, ruleId);
    this.assertQueryWhitelistPresence(dto.queryString, dto.queryWhitelist);
    const rule = await this.db.cacheRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.pattern !== undefined && { pattern: dto.pattern }),
        ...(dto.patternType !== undefined && { patternType: dto.patternType }),
        ...(dto.action !== undefined && { action: dto.action }),
        ...(dto.edgeTtl !== undefined && { edgeTtl: dto.edgeTtl }),
        ...(dto.browserTtl !== undefined && { browserTtl: dto.browserTtl }),
        ...(dto.queryString !== undefined && { queryString: dto.queryString }),
        ...(dto.queryWhitelist !== undefined && { queryWhitelist: dto.queryWhitelist }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
      },
    });
    await this.publisher.publish(zoneId);
    return rule;
  }

  async remove(orgId: string, zoneId: string, ruleId: string): Promise<void> {
    await this.findOwnedRule(orgId, zoneId, ruleId);
    await this.db.cacheRule.delete({ where: { id: ruleId } });
    await this.publisher.publish(zoneId);
  }

  async reorder(orgId: string, zoneId: string, order: string[]) {
    await this.findOwnedZone(orgId, zoneId);
    const rules = await this.db.cacheRule.findMany({ where: { zoneId } });
    const ruleIds = new Set(rules.map((r) => r.id));
    if (order.length !== rules.length || !order.every((id) => ruleIds.has(id))) {
      throw new BadRequestException("order must contain exactly the zone's existing rule ids");
    }
    await this.db.$transaction(
      order.map((id, index) =>
        this.db.cacheRule.update({ where: { id }, data: { priority: order.length - 1 - index } }),
      ),
    );
    await this.publisher.publish(zoneId);
    return this.list(orgId, zoneId, 0, 100);
  }

  private assertQueryWhitelistPresence(queryString?: string, whitelist?: string[]): void {
    if (queryString === 'whitelist' && (!whitelist || whitelist.length === 0)) {
      throw new BadRequestException('queryWhitelist is required when queryString is "whitelist"');
    }
  }

  private async findOwnedZone(orgId: string, zoneId: string): Promise<void> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== orgId) {
      throw new NotFoundException('Zone not found');
    }
  }

  private async findOwnedRule(orgId: string, zoneId: string, ruleId: string): Promise<CacheRule> {
    await this.findOwnedZone(orgId, zoneId);
    const rule = await this.db.cacheRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.zoneId !== zoneId) {
      throw new NotFoundException('Cache rule not found');
    }
    return rule;
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- rules.service`
Expected: PASS.

- [ ] **Step 10: Write the failing `RulesController` integration test**

Create `apps/cdn-service/src/rules/rules.controller.integration.test.ts` (mirror `zones.controller.integration.test.ts`'s `FakeIdentityClient` harness exactly):

```ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { IdentityClient } from '../auth/identity-client.js';
import type { CombinedAuthContext } from '../auth/auth-context.decorator.js';

class FakeIdentityClient {
  nextAuth: CombinedAuthContext | null = null;
  async verifyToken(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('FakeIdentityClient.nextAuth not set');
    return this.nextAuth;
  }
  async verifyApiKey(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('FakeIdentityClient.nextAuth not set');
    return this.nextAuth;
  }
}

describe('RulesController', () => {
  let app: INestApplication;
  let fakeIdentity: FakeIdentityClient;

  beforeAll(async () => {
    fakeIdentity = new FakeIdentityClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityClient)
      .useValue(fakeIdentity)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.cacheRule.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedZoneAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    const zone = await prisma.pullZone.create({
      data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
    });
    return zone;
  }

  it('creates and lists a cache rule', async () => {
    const zone = await seedZoneAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/api/*', action: 'bypass', edgeTtl: 0 });
    expect(created.status).toBe(201);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever');
    expect(list.status).toBe(200);
    expect(list.body.rules).toHaveLength(1);
  });

  it('rejects a viewer trying to create a rule', async () => {
    const zone = await seedZoneAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/api/*' });
    expect(response.status).toBe(403);
  });

  it('rejects whitelist query mode without a queryWhitelist', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/search', queryString: 'whitelist' });
    expect(response.status).toBe(400);
  });

  it('updates and deletes a rule', async () => {
    const zone = await seedZoneAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/a' });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/zones/${zone.id}/rules/${created.body.id}`)
      .set('Authorization', 'Bearer whatever')
      .send({ edgeTtl: 120 });
    expect(updated.status).toBe(200);
    expect(updated.body.edgeTtl).toBe(120);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/zones/${zone.id}/rules/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);
  });

  it('reorders rules', async () => {
    const zone = await seedZoneAndAuth('owner');
    const a = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/a' });
    const b = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules`)
      .set('Authorization', 'Bearer whatever')
      .send({ pattern: '/b' });

    const reordered = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/rules/reorder`)
      .set('Authorization', 'Bearer whatever')
      .send({ order: [b.body.id, a.body.id] });
    expect(reordered.status).toBe(201);
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- rules.controller`
Expected: FAIL — `AppModule` doesn't yet import a rules module, route 404s.

- [ ] **Step 12: Implement `RulesController` and `RulesModule`, wire into `AppModule`**

Create `apps/cdn-service/src/rules/rules.controller.ts`:

```ts
import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireZoneScope, ZoneScopeGuard } from '../auth/zone-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { RulesService } from './rules.service.js';
import { CreateCacheRuleDto } from './dto/create-rule.dto.js';
import { UpdateCacheRuleDto } from './dto/update-rule.dto.js';
import { ReorderRulesDto } from './dto/reorder-rules.dto.js';
import { ListRulesDto } from './dto/list-rules.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/zones/:zoneId/rules')
@UseGuards(AuthGuard, ZoneScopeGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Post()
  @RequireZoneScope('write')
  create(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: CreateCacheRuleDto) {
    return this.rules.create(requireOrgId(auth), zoneId, dto);
  }

  @Get()
  @RequireZoneScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Query() query: ListRulesDto) {
    return this.rules.list(requireOrgId(auth), zoneId, query.skip ?? 0, query.take ?? 50);
  }

  @Patch(':ruleId')
  @RequireZoneScope('write')
  update(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('zoneId') zoneId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateCacheRuleDto,
  ) {
    return this.rules.update(requireOrgId(auth), zoneId, ruleId, dto);
  }

  @Delete(':ruleId')
  @RequireZoneScope('delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Param('ruleId') ruleId: string) {
    await this.rules.remove(requireOrgId(auth), zoneId, ruleId);
    return { success: true };
  }

  @Post('reorder')
  @RequireZoneScope('write')
  reorder(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: ReorderRulesDto) {
    return this.rules.reorder(requireOrgId(auth), zoneId, dto.order);
  }
}
```

Create `apps/cdn-service/src/rules/rules.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller.js';
import { RulesService } from './rules.service.js';
import { RulesConfigPublisher } from './rules-config.publisher.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [RulesController],
  providers: [RulesService, RulesConfigPublisher],
})
export class RulesModule {}
```

In `apps/cdn-service/src/app.module.ts`, add the import and module:

```ts
import { RulesModule } from './rules/rules.module.js';
```

```ts
  imports: [EnvModule, PrismaModule, RedisModule, EventsModule, ZonesModule, RulesModule],
```

- [ ] **Step 13: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- rules.controller`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/cdn-service/src/rules apps/cdn-service/src/app.module.ts
git commit -m "feat(cdn-service): add cache rules CRUD, reorder, and Redis publishing"
```

---

### Task 4: Cache Invalidations module

**Files:**
- Create: `apps/cdn-service/src/invalidations/dto/create-invalidation.dto.ts`, `dto/list-invalidations.dto.ts`
- Create: `apps/cdn-service/src/invalidations/invalidations.service.ts`
- Test: `apps/cdn-service/src/invalidations/invalidations.service.integration.test.ts`
- Create: `apps/cdn-service/src/invalidations/invalidations.controller.ts`
- Test: `apps/cdn-service/src/invalidations/invalidations.controller.integration.test.ts`
- Create: `apps/cdn-service/src/invalidations/invalidations.module.ts`
- Modify: `apps/cdn-service/src/app.module.ts`

**Interfaces:**
- Consumes: `PRISMA`, `EventsService.requestMany` (Task 2), `AuthGuard`/`ZoneScopeGuard`/`RequireZoneScope('invalidate'|'read')` (Task 1), `AuthCtx`.
- Produces: `POST /api/v1/zones/:zoneId/cache/invalidate`, `POST /api/v1/zones/:zoneId/cache/purge`, `GET /api/v1/zones/:zoneId/cache/invalidations`, `GET /api/v1/zones/:zoneId/cache/invalidations/:invalidationId`.

- [ ] **Step 1: Write the DTOs**

`apps/cdn-service/src/invalidations/dto/create-invalidation.dto.ts`:

```ts
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateInvalidationDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  patterns?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
```

`apps/cdn-service/src/invalidations/dto/list-invalidations.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListInvalidationsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}
```

- [ ] **Step 2: Write the failing `InvalidationsService` integration test**

Create `apps/cdn-service/src/invalidations/invalidations.service.integration.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connect, type NatsConnection } from 'nats';
import { prisma } from '@rivocloud/db';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { InvalidationsService } from './invalidations.service.js';

const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222';
const events = new EventsService(natsUrl);
const service = new InvalidationsService(prisma, events);

async function seedZone() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  return { org, zone: await prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
  })};
}

describe('InvalidationsService', () => {
  let responder: NatsConnection | null = null;

  beforeEach(async () => {
    await prisma.cacheInvalidation.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await responder?.close();
    responder = null;
  });

  it('rejects an invalidation request with no patterns or tags', async () => {
    const { org, zone } = await seedZone();
    await expect(service.create(org.id, zone.id, null, {})).rejects.toThrow(BadRequestException);
  });

  it('rejects invalidating a zone owned by a different org', async () => {
    const { zone } = await seedZone();
    await expect(service.create('someone-elses-org', zone.id, null, { patterns: ['/x'] })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns pending immediately, then completes once an edge proxy replies', async () => {
    const { org, zone } = await seedZone();
    responder = await connect({ servers: natsUrl });
    const sub = responder.subscribe(`cache.invalidate.${zone.id}`);
    (async () => {
      for await (const msg of sub) {
        if (msg.reply) {
          responder!.publish(msg.reply, new TextEncoder().encode(JSON.stringify({ datacenter: 'local', keysPurged: 7, durationMs: 3 })));
        }
      }
    })();

    const result = await service.create(org.id, zone.id, null, { patterns: ['/logo.png'] });
    expect(result.status).toBe('pending');

    // collectAndFinalize runs in the background (not awaited by create()) —
    // poll briefly for the row to flip to completed.
    let final = await prisma.cacheInvalidation.findUnique({ where: { id: result.invalidationId } });
    for (let i = 0; i < 20 && final?.status !== 'completed'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      final = await prisma.cacheInvalidation.findUnique({ where: { id: result.invalidationId } });
    }
    expect(final?.status).toBe('completed');
    expect(final?.edgesNotified).toBe(1);
    expect(final?.keysPurged).toBe(7);
  });

  it('purgeAll invalidates with a wildcard pattern', async () => {
    const { org, zone } = await seedZone();
    const result = await service.purgeAll(org.id, zone.id, null);
    const row = await prisma.cacheInvalidation.findUnique({ where: { id: result.invalidationId } });
    expect(row?.patterns).toEqual(['*']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- invalidations.service`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `InvalidationsService`**

Create `apps/cdn-service/src/invalidations/invalidations.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CacheInvalidation, PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { EventsService } from '../events/events.service.js';
import type { CreateInvalidationDto } from './dto/create-invalidation.dto.js';

interface EdgeInvalidationReply {
  datacenter: string;
  keysPurged: number;
  durationMs: number;
}

const REPLY_WINDOW_MS = 5000;

@Injectable()
export class InvalidationsService {
  private readonly logger = new Logger(InvalidationsService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly events: EventsService,
  ) {}

  async create(
    orgId: string,
    zoneId: string,
    userId: string | null,
    dto: CreateInvalidationDto,
  ): Promise<{ invalidationId: string; status: string }> {
    await this.findOwnedZone(orgId, zoneId);
    const patterns = dto.patterns ?? [];
    const tags = dto.tags ?? [];
    if (patterns.length === 0 && tags.length === 0) {
      throw new BadRequestException('Provide at least one pattern or tag to invalidate');
    }

    const invalidation = await this.db.cacheInvalidation.create({
      data: { zoneId, createdBy: userId, patterns, tags, status: 'pending' },
    });

    // EDD Section 4.4: the API returns 202/pending immediately; aggregation
    // of edge replies happens afterward, in the background.
    void this.collectAndFinalize(zoneId, invalidation.id, patterns, tags).catch((error: Error) => {
      this.logger.error(`invalidation ${invalidation.id} failed to finalize: ${error.message}`);
    });

    return { invalidationId: invalidation.id, status: invalidation.status };
  }

  async purgeAll(orgId: string, zoneId: string, userId: string | null) {
    return this.create(orgId, zoneId, userId, { patterns: ['*'], tags: [] });
  }

  async list(orgId: string, zoneId: string, skip: number, take: number) {
    await this.findOwnedZone(orgId, zoneId);
    const [invalidations, total] = await Promise.all([
      this.db.cacheInvalidation.findMany({ where: { zoneId }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.cacheInvalidation.count({ where: { zoneId } }),
    ]);
    return { invalidations, total };
  }

  async getOne(orgId: string, zoneId: string, invalidationId: string): Promise<CacheInvalidation> {
    await this.findOwnedZone(orgId, zoneId);
    const invalidation = await this.db.cacheInvalidation.findUnique({ where: { id: invalidationId } });
    if (!invalidation || invalidation.zoneId !== zoneId) {
      throw new NotFoundException('Invalidation not found');
    }
    return invalidation;
  }

  private async collectAndFinalize(zoneId: string, invalidationId: string, patterns: string[], tags: string[]) {
    const replies = await this.events.requestMany<EdgeInvalidationReply>(
      `cache.invalidate.${zoneId}`,
      { zoneId, patterns, tags, invalidationId },
      REPLY_WINDOW_MS,
    );
    const keysPurged = replies.reduce((sum, reply) => sum + reply.keysPurged, 0);
    await this.db.cacheInvalidation.update({
      where: { id: invalidationId },
      data: { status: 'completed', edgesNotified: replies.length, keysPurged, completedAt: new Date() },
    });
  }

  private async findOwnedZone(orgId: string, zoneId: string): Promise<void> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== orgId) {
      throw new NotFoundException('Zone not found');
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- invalidations.service`
Expected: PASS.

- [ ] **Step 6: Write the failing `InvalidationsController` integration test**

Create `apps/cdn-service/src/invalidations/invalidations.controller.integration.test.ts` (same `FakeIdentityClient` harness as Task 3's controller test):

```ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { IdentityClient } from '../auth/identity-client.js';
import type { CombinedAuthContext } from '../auth/auth-context.decorator.js';

class FakeIdentityClient {
  nextAuth: CombinedAuthContext | null = null;
  async verifyToken(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('FakeIdentityClient.nextAuth not set');
    return this.nextAuth;
  }
  async verifyApiKey(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('FakeIdentityClient.nextAuth not set');
    return this.nextAuth;
  }
}

describe('InvalidationsController', () => {
  let app: INestApplication;
  let fakeIdentity: FakeIdentityClient;

  beforeAll(async () => {
    fakeIdentity = new FakeIdentityClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityClient)
      .useValue(fakeIdentity)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.cacheInvalidation.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedZoneAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    return prisma.pullZone.create({
      data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
    });
  }

  it('creates an invalidation and returns pending', async () => {
    const zone = await seedZoneAndAuth('developer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({ patterns: ['/logo.png'] });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('pending');
  });

  it('rejects a viewer trying to invalidate', async () => {
    const zone = await seedZoneAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({ patterns: ['/logo.png'] });
    expect(response.status).toBe(403);
  });

  it('rejects an invalidation with neither patterns nor tags', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({});
    expect(response.status).toBe(400);
  });

  it('purges the whole zone', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/purge`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(201);
  });

  it('lists and fetches invalidation history', async () => {
    const zone = await seedZoneAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/cache/invalidate`)
      .set('Authorization', 'Bearer whatever')
      .send({ patterns: ['/a'] });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zone.id}/cache/invalidations`)
      .set('Authorization', 'Bearer whatever');
    expect(list.body.invalidations).toHaveLength(1);

    const one = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zone.id}/cache/invalidations/${created.body.invalidationId}`)
      .set('Authorization', 'Bearer whatever');
    expect(one.status).toBe(200);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- invalidations.controller`
Expected: FAIL — 404s, no module wired.

- [ ] **Step 8: Implement `InvalidationsController` and `InvalidationsModule`, wire into `AppModule`**

Create `apps/cdn-service/src/invalidations/invalidations.controller.ts`:

```ts
import { Body, Controller, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireZoneScope, ZoneScopeGuard } from '../auth/zone-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { InvalidationsService } from './invalidations.service.js';
import { CreateInvalidationDto } from './dto/create-invalidation.dto.js';
import { ListInvalidationsDto } from './dto/list-invalidations.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/zones/:zoneId/cache')
@UseGuards(AuthGuard, ZoneScopeGuard)
export class InvalidationsController {
  constructor(private readonly invalidations: InvalidationsService) {}

  @Post('invalidate')
  @RequireZoneScope('invalidate')
  invalidate(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: CreateInvalidationDto) {
    return this.invalidations.create(requireOrgId(auth), zoneId, auth.userId, dto);
  }

  @Post('purge')
  @RequireZoneScope('invalidate')
  purge(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.invalidations.purgeAll(requireOrgId(auth), zoneId, auth.userId);
  }

  @Get('invalidations')
  @RequireZoneScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Query() query: ListInvalidationsDto) {
    return this.invalidations.list(requireOrgId(auth), zoneId, query.skip ?? 0, query.take ?? 50);
  }

  @Get('invalidations/:invalidationId')
  @RequireZoneScope('read')
  getOne(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('zoneId') zoneId: string,
    @Param('invalidationId') invalidationId: string,
  ) {
    return this.invalidations.getOne(requireOrgId(auth), zoneId, invalidationId);
  }
}
```

Create `apps/cdn-service/src/invalidations/invalidations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { InvalidationsController } from './invalidations.controller.js';
import { InvalidationsService } from './invalidations.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [InvalidationsController],
  providers: [InvalidationsService],
})
export class InvalidationsModule {}
```

In `apps/cdn-service/src/app.module.ts`:

```ts
import { InvalidationsModule } from './invalidations/invalidations.module.js';
```

```ts
  imports: [EnvModule, PrismaModule, RedisModule, EventsModule, ZonesModule, RulesModule, InvalidationsModule],
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- invalidations.controller`
Expected: PASS.

- [ ] **Step 10: Run the full CDN Service test suite**

Run: `pnpm --filter @rivocloud/cdn-service test:unit && pnpm --filter @rivocloud/cdn-service test:integration`
Expected: PASS (everything, old and new).

- [ ] **Step 11: Commit**

```bash
git add apps/cdn-service/src/invalidations apps/cdn-service/src/app.module.ts
git commit -m "feat(cdn-service): add cache invalidation endpoints with NATS scatter-gather"
```

---

### Task 5: Go `globmatch` package

**Files:**
- Create: `apps/edge-proxy/internal/globmatch/globmatch.go`
- Test: `apps/edge-proxy/internal/globmatch/globmatch_test.go`

**Interfaces:**
- Consumes: nothing (Go stdlib `strings` only).
- Produces: `globmatch.Match(pattern, path string) bool` — `*` matches any sequence of characters (including `/`), everything else matches literally. Used by Task 6 (cache rules) and Task 9 (purge).

- [ ] **Step 1: Write the failing test**

Create `apps/edge-proxy/internal/globmatch/globmatch_test.go`:

```go
package globmatch

import "testing"

func TestMatch_ExactLiteral(t *testing.T) {
	if !Match("/logo.png", "/logo.png") {
		t.Fatal("expected an exact literal to match itself")
	}
	if Match("/logo.png", "/other.png") {
		t.Fatal("expected different literals to not match")
	}
}

func TestMatch_TrailingStarMatchesAnySuffix(t *testing.T) {
	if !Match("/assets/*", "/assets/app.js") {
		t.Fatal("expected /assets/* to match /assets/app.js")
	}
	if !Match("/assets/*", "/assets/vendor/bundle.js") {
		t.Fatal("expected /assets/* to match across a nested slash")
	}
	if Match("/assets/*", "/other/app.js") {
		t.Fatal("expected /assets/* to not match a different prefix")
	}
}

func TestMatch_SuffixStarMatchesFileExtension(t *testing.T) {
	if !Match("/assets/*.js", "/assets/app.js") {
		t.Fatal("expected /assets/*.js to match /assets/app.js")
	}
	if Match("/assets/*.js", "/assets/app.css") {
		t.Fatal("expected /assets/*.js to not match a .css file")
	}
}

func TestMatch_BareStarMatchesEverything(t *testing.T) {
	if !Match("*", "/anything/at/all") {
		t.Fatal("expected a bare * to match any path (whole-zone purge)")
	}
}

func TestMatch_MultipleStars(t *testing.T) {
	if !Match("/api/*/detail*", "/api/users/detail-42") {
		t.Fatal("expected multiple wildcards to all be honored")
	}
	if Match("/api/*/detail*", "/api/users/summary-42") {
		t.Fatal("expected the literal 'detail' segment to still be required")
	}
}

func TestMatch_NoWildcardRequiresExactMatch(t *testing.T) {
	if Match("/logo.png", "/logo.png?v=2") {
		t.Fatal("expected a pattern with no wildcard to require an exact match")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit -- ./internal/globmatch/...`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement**

Create `apps/edge-proxy/internal/globmatch/globmatch.go`:

```go
// Package globmatch implements the simple wildcard syntax the EDD specifies
// for cache rule patterns and invalidation patterns (Section 5.2/5.3): '*'
// matches any sequence of characters, including '/' — "/assets/*" matches
// both "/assets/app.js" and "/assets/vendor/bundle.js" (concept doc, Section
// 3.2). This is the one glob primitive shared by cache-rule matching
// (internal/cacherules) and cache purge (internal/cachestore, internal/proxy).
package globmatch

import "strings"

// Match reports whether path matches pattern. A pattern with no '*' requires
// an exact match; each '*' is a greedy wildcard matching zero or more
// characters, resolved as a sequence of literal segments that must appear in
// order.
func Match(pattern, path string) bool {
	if !strings.Contains(pattern, "*") {
		return pattern == path
	}

	segments := strings.Split(pattern, "*")

	// The first segment must be a genuine prefix (no wildcard precedes it);
	// the last must be a genuine suffix (no wildcard follows it). Segments
	// in between may appear anywhere, in order, without overlapping.
	if !strings.HasPrefix(path, segments[0]) {
		return false
	}
	path = path[len(segments[0]):]

	last := len(segments) - 1
	if !strings.HasSuffix(path, segments[last]) {
		return false
	}
	if last > 0 {
		path = path[:len(path)-len(segments[last])]
	} else {
		// A pattern like "prefix*" with no further segments: the prefix
		// check above already consumed everything meaningful.
		return true
	}

	for _, seg := range segments[1:last] {
		if seg == "" {
			continue // consecutive '*' or a '*' adjacent to another segment boundary
		}
		idx := strings.Index(path, seg)
		if idx == -1 {
			return false
		}
		path = path[idx+len(seg):]
	}
	return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit -- ./internal/globmatch/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-proxy/internal/globmatch
git commit -m "feat(edge-proxy): add globmatch package for cache rules and purge"
```

---

### Task 6: Go `cacherules` package

**Files:**
- Create: `apps/edge-proxy/internal/cacherules/cacherules.go`
- Test: `apps/edge-proxy/internal/cacherules/cacherules_test.go`

**Interfaces:**
- Consumes: `globmatch.Match` (Task 5).
- Produces: `cacherules.Rule` struct; `cacherules.SortByPriorityDesc(rules []Rule) []Rule`; `cacherules.Match(rules []Rule, path string) (Rule, bool)` (first rule in the given order whose pattern matches `path`; callers pass an already-priority-sorted slice). Used by Task 10 (`zone.Config.Rules`) and Task 11 (`handler.go`).

- [ ] **Step 1: Write the failing test**

Create `apps/edge-proxy/internal/cacherules/cacherules_test.go`:

```go
package cacherules

import "testing"

func TestMatch_GlobPattern(t *testing.T) {
	rules := []Rule{{Pattern: "/assets/*", PatternType: "glob", Priority: 0}}
	rule, ok := Match(rules, "/assets/app.js")
	if !ok || rule.Pattern != "/assets/*" {
		t.Fatalf("expected a match, got %+v ok=%v", rule, ok)
	}
}

func TestMatch_ExactPattern(t *testing.T) {
	rules := []Rule{{Pattern: "/exact/path", PatternType: "exact", Priority: 0}}
	if _, ok := Match(rules, "/exact/path/extra"); ok {
		t.Fatal("expected an exact pattern type to require a full literal match, not a prefix")
	}
	if _, ok := Match(rules, "/exact/path"); !ok {
		t.Fatal("expected an exact pattern type to match the identical path")
	}
}

func TestMatch_RegexPattern(t *testing.T) {
	rules := []Rule{{Pattern: `^/api/v[0-9]+/.*$`, PatternType: "regex", Priority: 0}}
	if _, ok := Match(rules, "/api/v2/users"); !ok {
		t.Fatal("expected the regex pattern to match")
	}
	if _, ok := Match(rules, "/other"); ok {
		t.Fatal("expected the regex pattern to reject a non-matching path")
	}
}

func TestMatch_InvalidRegexNeverMatches(t *testing.T) {
	rules := []Rule{{Pattern: "([", PatternType: "regex", Priority: 0}}
	if _, ok := Match(rules, "anything"); ok {
		t.Fatal("expected an unparseable regex to simply never match, not panic")
	}
}

func TestMatch_FirstRuleInOrderWins(t *testing.T) {
	rules := SortByPriorityDesc([]Rule{
		{Pattern: "/assets/*", PatternType: "glob", Priority: 1},
		{Pattern: "/assets/*.js", PatternType: "glob", Priority: 10},
	})
	rule, ok := Match(rules, "/assets/app.js")
	if !ok || rule.Priority != 10 {
		t.Fatalf("expected the higher-priority, more specific rule to win, got %+v", rule)
	}
}

func TestMatch_NoRuleMatches(t *testing.T) {
	rules := []Rule{{Pattern: "/only-this", PatternType: "exact", Priority: 0}}
	if _, ok := Match(rules, "/something-else"); ok {
		t.Fatal("expected no match")
	}
}

func TestSortByPriorityDesc(t *testing.T) {
	sorted := SortByPriorityDesc([]Rule{
		{Pattern: "a", Priority: 1},
		{Pattern: "b", Priority: 10},
		{Pattern: "c", Priority: 5},
	})
	if sorted[0].Pattern != "b" || sorted[1].Pattern != "c" || sorted[2].Pattern != "a" {
		t.Fatalf("expected descending priority order, got %+v", sorted)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit -- ./internal/cacherules/...`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement**

Create `apps/edge-proxy/internal/cacherules/cacherules.go`:

```go
// Package cacherules evaluates a zone's per-path cache rules (EDD Section
// 6.2 cache_rules table, concept doc Section 3): the first rule to match a
// request path — checked in priority order — decides that request's
// caching action, edge/browser TTL, and query-string normalization mode,
// overriding the origin-header-driven priority chain in internal/httpcache
// (EDD Section 5.3, Priority 1).
package cacherules

import (
	"regexp"
	"sort"

	"rivocloud/edge-proxy/internal/globmatch"
)

// Rule mirrors one row of the CDN Service's cache_rules table (field names
// match apps/cdn-service's zone_rules:{zoneId} Redis JSON exactly).
type Rule struct {
	Pattern        string
	PatternType    string // "glob" (default), "regex", "exact"
	Action         string // "cache" (default), "bypass", "no-store"
	EdgeTTL        *int   // seconds; nil = fall back to origin headers / zone default
	BrowserTTL     *int   // seconds; nil = fall back to today's edge-TTL-derived max-age
	QueryString    string // "strip_all" (default), "whitelist", "include_all"
	QueryWhitelist []string
	Priority       int
}

// SortByPriorityDesc returns a new slice ordered highest-priority-first
// (EDD: "higher = evaluated first"). The input is not mutated.
func SortByPriorityDesc(rules []Rule) []Rule {
	sorted := make([]Rule, len(rules))
	copy(sorted, rules)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Priority > sorted[j].Priority })
	return sorted
}

// Match returns the first rule (in the given order — callers pass an
// already-priority-sorted slice) whose pattern matches path, per its
// PatternType. An unparseable regex pattern never matches rather than
// panicking, so one bad rule can't take down request handling.
func Match(rules []Rule, path string) (Rule, bool) {
	for _, rule := range rules {
		if matches(rule, path) {
			return rule, true
		}
	}
	return Rule{}, false
}

func matches(rule Rule, path string) bool {
	switch rule.PatternType {
	case "exact":
		return rule.Pattern == path
	case "regex":
		re, err := regexp.Compile(rule.Pattern)
		if err != nil {
			return false
		}
		return re.MatchString(path)
	default: // "glob", and anything unrecognized falls back to glob
		return globmatch.Match(rule.Pattern, path)
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit -- ./internal/cacherules/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-proxy/internal/cacherules
git commit -m "feat(edge-proxy): add cacherules package for priority-ordered rule matching"
```

---

### Task 7: `cachekey.Build` gains query-string normalization modes

**Files:**
- Modify: `apps/edge-proxy/internal/cachekey/cachekey.go`
- Modify: `apps/edge-proxy/internal/cachekey/cachekey_test.go`

**Interfaces:**
- Consumes: nothing new.
- Produces: `cachekey.Build(zoneID, method, host, path, rawQuery, queryMode string, queryWhitelist []string) string` (signature change — two new trailing parameters). `queryMode` is one of `"strip_all"`, `"whitelist"`, `"include_all"`; any other value (including `""`) behaves as `"include_all"`, preserving today's behavior.

- [ ] **Step 1: Update existing tests for the new signature, and add new-mode tests**

In `apps/edge-proxy/internal/cachekey/cachekey_test.go`, update every existing `Build(...)` call to append `, "include_all", nil` (preserving current behavior exactly), then add:

```go
func TestBuild_StripAllIgnoresEveryQueryParam(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/img.jpg", "v=1&utm=email", "strip_all", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/img.jpg", "", "strip_all", nil)
	if a != b {
		t.Fatal("expected strip_all to produce the same key regardless of query string")
	}
}

func TestBuild_WhitelistKeepsOnlyListedParams(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/search", "q=cats&page=2&utm=email", "whitelist", []string{"q", "page"})
	b := Build("zone1", "GET", "cdn.example.com", "/search", "q=cats&page=2", "whitelist", []string{"q", "page"})
	if a != b {
		t.Fatal("expected whitelist mode to ignore params not on the whitelist")
	}
	c := Build("zone1", "GET", "cdn.example.com", "/search", "q=cats&page=3", "whitelist", []string{"q", "page"})
	if a == c {
		t.Fatal("expected a different whitelisted param value to change the key")
	}
}

func TestBuild_WhitelistIgnoresUnlistedEvenIfOnlyParam(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/page", "_ga=tracking", "whitelist", []string{"content"})
	b := Build("zone1", "GET", "cdn.example.com", "/page", "", "whitelist", []string{"content"})
	if a != b {
		t.Fatal("expected an unlisted-only query string to normalize the same as no query string")
	}
}

func TestBuild_UnknownQueryModeFallsBackToIncludeAll(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/p", "b=2&a=1", "", nil)
	b := Build("zone1", "GET", "cdn.example.com", "/p", "a=1&b=2", "include_all", nil)
	if a != b {
		t.Fatal("expected an empty/unknown queryMode to behave exactly like include_all")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit -- ./internal/cachekey/...`
Expected: FAIL — wrong number of arguments to `Build`.

- [ ] **Step 3: Implement**

In `apps/edge-proxy/internal/cachekey/cachekey.go`, replace `Build` and `normalizeQuery`:

```go
// Build constructs the canonical cache key for a request, per the EDD's
// cache-key design (Section 5.2): zone + method + normalized host/path/query,
// hashed with SHA-256. queryMode/queryWhitelist implement the per-rule
// query-string normalization from cache_rules (EDD Section 6.2): "strip_all"
// drops every query param, "whitelist" keeps only queryWhitelist's keys,
// "include_all" (also the fallback for "" or an unrecognized mode, matching
// pre-Stage-7 behavior) sorts and keeps every param.
func Build(zoneID, method, host, path, rawQuery, queryMode string, queryWhitelist []string) string {
	h := sha256.New()
	h.Write([]byte(zoneID))
	h.Write([]byte{'|'})
	h.Write([]byte(strings.ToUpper(method)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizeHost(host)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizePath(path)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizeQuery(rawQuery, queryMode, queryWhitelist)))
	return hex.EncodeToString(h.Sum(nil))
}
```

```go
func normalizeQuery(rawQuery, queryMode string, whitelist []string) string {
	if queryMode == "strip_all" {
		return ""
	}
	if rawQuery == "" {
		return ""
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return rawQuery
	}
	if queryMode == "whitelist" {
		allowed := make(map[string]bool, len(whitelist))
		for _, k := range whitelist {
			allowed[k] = true
		}
		for k := range values {
			if !allowed[k] {
				delete(values, k)
			}
		}
	}
	if len(values) == 0 {
		return ""
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// Emit each pair RE-ESCAPED, never the decoded Go string. Writing back
	// decoded values would collapse "?a=b%26c%3Dd" (one param whose value is
	// literally "b&c=d") onto "?a=b&c=d" (two params) — the origin still
	// receives the raw query and returns different content for each, so a
	// shared key would serve one request's body for the other's. Because
	// url.QueryEscape never emits a bare '&' or '=', the joined form uniquely
	// determines the pairs it was built from.
	pairs := make([]string, 0, len(values))
	for _, k := range keys {
		vs := append([]string{}, values[k]...)
		sort.Strings(vs)
		for _, v := range vs {
			pairs = append(pairs, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	return strings.Join(pairs, "&")
}
```

- [ ] **Step 4: Update the one production call site**

In `apps/edge-proxy/internal/proxy/handler.go`, the existing call:

```go
	key := cachekey.Build(z.ID, cachekey.NormalizeMethod(r.Method), r.Host, r.URL.Path, r.URL.RawQuery)
```

will be replaced in Task 11 (once rule matching exists to supply the mode). For this task only, make it compile by passing the fixed default:

```go
	key := cachekey.Build(z.ID, cachekey.NormalizeMethod(r.Method), r.Host, r.URL.Path, r.URL.RawQuery, "include_all", nil)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit`
Expected: PASS (all packages compile and pass, since `handler.go` was updated to match the new signature).

- [ ] **Step 6: Commit**

```bash
git add apps/edge-proxy/internal/cachekey apps/edge-proxy/internal/proxy/handler.go
git commit -m "feat(edge-proxy): add strip_all/whitelist/include_all query-string modes to cachekey.Build"
```

---

### Task 8: `cachestore.Entry` gains `ZoneID`/`Path`/`Tags`/`BrowserTTL`; `Layer` gains `Purge`

**Files:**
- Modify: `apps/edge-proxy/internal/cachestore/entry.go`
- Modify: `apps/edge-proxy/internal/cachestore/layer.go`
- Modify: `apps/edge-proxy/internal/cachestore/memory.go`
- Modify: `apps/edge-proxy/internal/cachestore/memory_test.go`
- Modify: `apps/edge-proxy/internal/cachestore/redis.go`
- Modify: `apps/edge-proxy/internal/cachestore/redis_integration_test.go`

**Interfaces:**
- Consumes: `globmatch.Match` (Task 5).
- Produces: `Entry.ZoneID`, `Entry.Path`, `Entry.Tags []string`, `Entry.BrowserTTL *time.Duration`; `Layer.Purge(ctx context.Context, zoneID string, patterns []string, tags []string) (int, error)` on both `Memory` and `Redis`. Used by Task 11 (population) and Task 12 (invocation from the invalidation subscriber).

- [ ] **Step 1: Write the failing `Memory.Purge` unit tests**

Add to `apps/edge-proxy/internal/cachestore/memory_test.go`:

```go
func TestMemory_PurgeByPathPattern(t *testing.T) {
	m, _ := NewMemory(10)
	ctx := context.Background()
	_ = m.Set(ctx, "key-a", Entry{ZoneID: "z1", Path: "/assets/app.js", Body: []byte("a")})
	_ = m.Set(ctx, "key-b", Entry{ZoneID: "z1", Path: "/index.html", Body: []byte("b")})
	_ = m.Set(ctx, "key-c", Entry{ZoneID: "z2", Path: "/assets/app.js", Body: []byte("c")})

	count, err := m.Purge(ctx, "z1", []string{"/assets/*"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 key purged, got %d", count)
	}
	if _, ok, _ := m.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged")
	}
	if _, ok, _ := m.Get(ctx, "key-b"); !ok {
		t.Fatal("expected key-b (different path) to remain")
	}
	if _, ok, _ := m.Get(ctx, "key-c"); !ok {
		t.Fatal("expected key-c (different zone) to remain")
	}
}

func TestMemory_PurgeByTag(t *testing.T) {
	m, _ := NewMemory(10)
	ctx := context.Background()
	_ = m.Set(ctx, "key-a", Entry{ZoneID: "z1", Path: "/posts/1", Tags: []string{"blog-post-123"}})
	_ = m.Set(ctx, "key-b", Entry{ZoneID: "z1", Path: "/feed.xml", Tags: []string{"blog-post-123", "feed"}})
	_ = m.Set(ctx, "key-c", Entry{ZoneID: "z1", Path: "/other", Tags: []string{"unrelated"}})

	count, err := m.Purge(ctx, "z1", nil, []string{"blog-post-123"})
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected 2 keys purged, got %d", count)
	}
	if _, ok, _ := m.Get(ctx, "key-c"); !ok {
		t.Fatal("expected key-c (no matching tag) to remain")
	}
}

func TestMemory_PurgeWithNoPatternsOrTagsPurgesNothing(t *testing.T) {
	m, _ := NewMemory(10)
	ctx := context.Background()
	_ = m.Set(ctx, "key-a", Entry{ZoneID: "z1", Path: "/a"})

	count, err := m.Purge(ctx, "z1", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected 0 keys purged when no patterns/tags given, got %d", count)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit -- ./internal/cachestore/...`
Expected: FAIL — `Entry` has no `ZoneID`/`Path`/`Tags` fields, `Memory` has no `Purge` method.

- [ ] **Step 3: Implement `Entry` fields, `Layer.Purge`, and `Memory.Purge`**

In `apps/edge-proxy/internal/cachestore/entry.go`, add fields:

```go
// Entry is a single cached response, stored identically in every layer so
// the proxy handler can treat L1 and L2 the same way.
type Entry struct {
	StatusCode int
	Header     http.Header
	Body       []byte
	ETag       string
	Cacheable  bool
	StoredAt   time.Time
	ExpiresAt  time.Time // edge TTL deadline — past this, revalidate
	StaleUntil time.Time // absolute deadline for serving this on origin error

	// ZoneID and Path identify what this entry actually is, in plain text —
	// unlike the SHA-256 cache key, which is one-way. Populated at write
	// time (internal/proxy/handler.go) so a purge operation (Task 9) can
	// glob-match a pattern against Path without needing a separate index,
	// matching the EDD's own flow diagram ("SCAN Redis for matching keys").
	ZoneID string
	Path   string
	// Tags supports invalidation-by-tag (EDD Section 4.4's tags[] field).
	// Populated from an origin response's Cache-Tag header, if present — see
	// the plan's Design Decisions #1 for why this convention exists.
	Tags []string
	// BrowserTTL, when set, overrides the browser-facing Cache-Control
	// max-age independent of ExpiresAt (a matched cache rule's browserTtl,
	// EDD Section 6.2). Nil means "use the remaining edge TTL," today's
	// only behavior.
	BrowserTTL *time.Duration
}
```

In `apps/edge-proxy/internal/cachestore/layer.go`:

```go
package cachestore

import "context"

// Layer is one level of the 3-layer cache (L1 in-process LRU or L2 Redis).
// The proxy handler checks layers fastest-to-slowest and populates faster
// layers on a slower-layer hit (EDD Section 2.1).
type Layer interface {
	Get(ctx context.Context, key string) (Entry, bool, error)
	Set(ctx context.Context, key string, entry Entry) error
	// Purge deletes every entry in this zone whose Path glob-matches any of
	// patterns, or whose Tags intersects tags, returning how many keys were
	// removed (EDD Section 4.4). An empty patterns and empty tags purges
	// nothing — callers must supply at least one, matching the CDN
	// Service's own validation that an invalidation needs a pattern or a
	// tag (apps/cdn-service/src/invalidations/invalidations.service.ts).
	Purge(ctx context.Context, zoneID string, patterns []string, tags []string) (int, error)
}
```

In `apps/edge-proxy/internal/cachestore/memory.go`:

```go
package cachestore

import (
	"context"

	lru "github.com/hashicorp/golang-lru/v2"

	"rivocloud/edge-proxy/internal/globmatch"
)

// Memory is the L1 in-process cache: an LRU of a fixed maximum entry count,
// not shared between Edge Proxy replicas (EDD Section 2.1).
type Memory struct {
	cache *lru.Cache[string, Entry]
}

func NewMemory(maxEntries int) (*Memory, error) {
	c, err := lru.New[string, Entry](maxEntries)
	if err != nil {
		return nil, err
	}
	return &Memory{cache: c}, nil
}

func (m *Memory) Get(_ context.Context, key string) (Entry, bool, error) {
	e, ok := m.cache.Get(key)
	return e, ok, nil
}

func (m *Memory) Set(_ context.Context, key string, entry Entry) error {
	m.cache.Add(key, entry)
	return nil
}

func (m *Memory) Purge(_ context.Context, zoneID string, patterns []string, tags []string) (int, error) {
	if len(patterns) == 0 && len(tags) == 0 {
		return 0, nil
	}
	purged := 0
	for _, key := range m.cache.Keys() {
		entry, ok := m.cache.Peek(key)
		if !ok || entry.ZoneID != zoneID {
			continue
		}
		if matchesAny(entry, patterns, tags) {
			m.cache.Remove(key)
			purged++
		}
	}
	return purged, nil
}

// matchesAny is shared by every Layer's Purge: an entry matches if its Path
// glob-matches any pattern, OR it carries any of the requested tags.
func matchesAny(entry Entry, patterns []string, tags []string) bool {
	for _, pattern := range patterns {
		if globmatch.Match(pattern, entry.Path) {
			return true
		}
	}
	for _, tag := range tags {
		for _, entryTag := range entry.Tags {
			if entryTag == tag {
				return true
			}
		}
	}
	return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit -- ./internal/cachestore/...`
Expected: PASS.

- [ ] **Step 5: Write the failing `Redis.Purge` integration test**

Add to `apps/edge-proxy/internal/cachestore/redis_integration_test.go`:

```go
func TestRedis_PurgeByPathPattern(t *testing.T) {
	r := newTestRedisLayer(t)
	ctx := context.Background()
	future := time.Now().Add(time.Hour)
	_ = r.Set(ctx, "key-a", Entry{ZoneID: "z1", Path: "/assets/app.js", StaleUntil: future})
	_ = r.Set(ctx, "key-b", Entry{ZoneID: "z1", Path: "/index.html", StaleUntil: future})
	_ = r.Set(ctx, "key-c", Entry{ZoneID: "z2", Path: "/assets/app.js", StaleUntil: future})

	count, err := r.Purge(ctx, "z1", []string{"/assets/*"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 key purged, got %d", count)
	}
	if _, ok, _ := r.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged")
	}
	if _, ok, _ := r.Get(ctx, "key-b"); !ok {
		t.Fatal("expected key-b (different path) to remain")
	}
	if _, ok, _ := r.Get(ctx, "key-c"); !ok {
		t.Fatal("expected key-c (different zone) to remain")
	}
}

func TestRedis_PurgeByTag(t *testing.T) {
	r := newTestRedisLayer(t)
	ctx := context.Background()
	future := time.Now().Add(time.Hour)
	_ = r.Set(ctx, "tag-key-a", Entry{ZoneID: "z1", Path: "/posts/1", Tags: []string{"blog-post-123"}, StaleUntil: future})
	_ = r.Set(ctx, "tag-key-b", Entry{ZoneID: "z1", Path: "/other", Tags: []string{"unrelated"}, StaleUntil: future})

	count, err := r.Purge(ctx, "z1", nil, []string{"blog-post-123"})
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 key purged, got %d", count)
	}
	if _, ok, _ := r.Get(ctx, "tag-key-b"); !ok {
		t.Fatal("expected tag-key-b (no matching tag) to remain")
	}
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/edge-proxy test:integration -- ./internal/cachestore/...`
Expected: FAIL — `Redis` has no `Purge` method.

- [ ] **Step 7: Implement `Redis.Purge`**

In `apps/edge-proxy/internal/cachestore/redis.go`:

```go
package cachestore

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"

	"rivocloud/edge-proxy/internal/globmatch"
)

// Redis is the L2 cache: shared by every Edge Proxy replica in a PoP
// (EDD Section 2.1).
type Redis struct {
	client *redis.Client
	prefix string
}

func NewRedis(client *redis.Client, prefix string) *Redis {
	return &Redis{client: client, prefix: prefix}
}

func (r *Redis) Get(ctx context.Context, key string) (Entry, bool, error) {
	raw, err := r.client.Get(ctx, r.prefix+key).Bytes()
	if errors.Is(err, redis.Nil) {
		return Entry{}, false, nil
	}
	if err != nil {
		return Entry{}, false, err
	}
	var e Entry
	if err := json.Unmarshal(raw, &e); err != nil {
		return Entry{}, false, err
	}
	return e, true, nil
}

func (r *Redis) Set(ctx context.Context, key string, entry Entry) error {
	ttl := time.Until(entry.StaleUntil)
	if ttl <= 0 {
		return nil // already past its stale-if-error deadline; not worth storing
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, r.prefix+key, raw, ttl).Err()
}

// Purge implements the EDD's Section 4.4 flow literally: "SCAN Redis for
// matching keys → delete." There is no secondary path/tag index — this
// service's own keys (prefix-scoped) are enumerated, each fetched and
// filtered by ZoneID/Path/Tags, and matches deleted. SCAN is safe to run
// against a live Redis (non-blocking, cursor-based), and at Phase 1's
// single-PoP scale the total key count this walks is small.
func (r *Redis) Purge(ctx context.Context, zoneID string, patterns []string, tags []string) (int, error) {
	if len(patterns) == 0 && len(tags) == 0 {
		return 0, nil
	}
	purged := 0
	var cursor uint64
	for {
		keys, next, err := r.client.Scan(ctx, cursor, r.prefix+"*", 200).Result()
		if err != nil {
			return purged, err
		}
		for _, redisKey := range keys {
			raw, err := r.client.Get(ctx, redisKey).Bytes()
			if errors.Is(err, redis.Nil) {
				continue // deleted between SCAN and GET; nothing to purge
			}
			if err != nil {
				return purged, err
			}
			var entry Entry
			if err := json.Unmarshal(raw, &entry); err != nil {
				continue
			}
			if entry.ZoneID != zoneID {
				continue
			}
			if matchesAny(entry, patterns, tags) {
				if err := r.client.Del(ctx, redisKey).Err(); err != nil {
					return purged, err
				}
				purged++
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return purged, nil
}
```

(`globmatch` is imported by `memory.go`'s `matchesAny`, which `redis.go` also calls — both files are in package `cachestore`, so only one import of `globmatch` is needed across the package; `redis.go`'s own import list above can be trimmed if `go vet` flags it as unused, since `matchesAny` lives in `memory.go`.)

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/edge-proxy test:integration -- ./internal/cachestore/...`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/edge-proxy/internal/cachestore
git commit -m "feat(edge-proxy): add ZoneID/Path/Tags/BrowserTTL to Entry and Purge to Layer"
```

---

### Task 9: `zone.Config` gains `Rules`, read from `zone_rules:{zoneId}`

**Files:**
- Modify: `apps/edge-proxy/internal/zone/zone.go`
- Modify: `apps/edge-proxy/internal/zone/redis_registry.go`
- Modify: `apps/edge-proxy/internal/zone/redis_registry_integration_test.go`

**Interfaces:**
- Consumes: `cacherules.Rule`, `cacherules.SortByPriorityDesc` (Task 6).
- Produces: `zone.Config.Rules []cacherules.Rule` (already priority-sorted), populated by `RedisRegistry` alongside the existing zone config read, refreshed on the same 60s TTL / `EvictZone` path.

- [ ] **Step 1: Write the failing integration test**

Add to `apps/edge-proxy/internal/zone/redis_registry_integration_test.go`:

```go
func TestRedisRegistry_ResolvesRulesSortedByPriorityDescending(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "rules.cdn.rivocloud.dev", "zone-rules-1", redisConfig{
		ID: "zone-rules-1", Slug: "rules", OriginURL: "https://api.example.com", CacheTTL: 3600, Enabled: true,
	})
	rulesJSON := `[
		{"pattern":"/assets/*","patternType":"glob","action":"cache","edgeTtl":604800,"priority":1},
		{"pattern":"/api/*","patternType":"glob","action":"bypass","edgeTtl":0,"priority":10}
	]`
	if err := client.Set(context.Background(), "zone_rules:zone-rules-1", rulesJSON, 0).Err(); err != nil {
		t.Fatal(err)
	}

	registry := NewRedisRegistry(client)
	cfg, ok := registry.Resolve("rules.cdn.rivocloud.dev")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if len(cfg.Rules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(cfg.Rules))
	}
	if cfg.Rules[0].Pattern != "/api/*" || cfg.Rules[0].Priority != 10 {
		t.Fatalf("expected the priority-10 rule first, got %+v", cfg.Rules[0])
	}
}

func TestRedisRegistry_MissingRulesKeyResolvesWithNoRules(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "norules.cdn.rivocloud.dev", "zone-no-rules", redisConfig{
		ID: "zone-no-rules", Slug: "norules", OriginURL: "https://api.example.com", CacheTTL: 3600, Enabled: true,
	})

	registry := NewRedisRegistry(client)
	cfg, ok := registry.Resolve("norules.cdn.rivocloud.dev")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if len(cfg.Rules) != 0 {
		t.Fatalf("expected no rules, got %+v", cfg.Rules)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/edge-proxy test:integration -- ./internal/zone/...`
Expected: FAIL — `Config` has no `Rules` field.

- [ ] **Step 3: Implement**

In `apps/edge-proxy/internal/zone/zone.go`, add the import and field:

```go
package zone

import (
	"strings"
	"time"

	"rivocloud/edge-proxy/internal/cacherules"
)

// Config describes one CDN zone: which inbound Host header it matches and
// which origin server requests are forwarded to. Stage 3 hardcoded these in
// main.go; Stage 4's zone.RedisRegistry now resolves them from Redis
// instead. Host is populated by StaticRegistry for its own lookup; a
// Config returned by RedisRegistry leaves it empty, since nothing
// downstream reads Host off an already-resolved Config.
type Config struct {
	ID         string
	Host       string
	OriginURL  string
	DefaultTTL time.Duration
	// Rules is this zone's cache rules, pre-sorted highest-priority-first
	// (Stage 7), read from zone_rules:{ID} in Redis. Empty for a zone with
	// no rules configured, or for a Config built by StaticRegistry.
	Rules []cacherules.Rule
}
```

In `apps/edge-proxy/internal/zone/redis_registry.go`, add a rules-JSON struct, and read/attach rules inside `resolveConfig`:

```go
// redisRule mirrors one element of the JSON array the CDN Service writes to
// zone_rules:{zoneId} (apps/cdn-service/src/rules/rules-config.publisher.ts).
type redisRule struct {
	Pattern        string   `json:"pattern"`
	PatternType    string   `json:"patternType"`
	Action         string   `json:"action"`
	EdgeTTL        *int     `json:"edgeTtl"`
	BrowserTTL     *int     `json:"browserTtl"`
	QueryString    string   `json:"queryString"`
	QueryWhitelist []string `json:"queryWhitelist"`
	Priority       int      `json:"priority"`
}
```

Replace `resolveConfig`'s body (the whole function) with a version that also reads `zone_rules:{zoneID}` after the existing `zone_config:{zoneID}` read succeeds:

```go
func (r *RedisRegistry) resolveConfig(zoneID string) (Config, bool) {
	r.mu.RLock()
	entry, ok := r.zoneConfig[zoneID]
	r.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.cfg, entry.found
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	raw, err := r.client.Get(ctx, "zone_config:"+zoneID).Result()

	var cfg Config
	found := false
	switch {
	case err == nil:
		var rc redisConfig
		if jsonErr := json.Unmarshal([]byte(raw), &rc); jsonErr != nil {
			log.Printf("zone: bad zone_config JSON for %q: %v", zoneID, jsonErr)
		} else if rc.Enabled {
			cfg = Config{ID: rc.ID, OriginURL: rc.OriginURL, DefaultTTL: time.Duration(rc.CacheTTL) * time.Second}
			cfg.Rules = r.resolveRules(ctx, zoneID)
			found = true
		}
	case !errors.Is(err, redis.Nil):
		log.Printf("zone: zone_config lookup error for %q: %v", zoneID, err)
	}

	r.mu.Lock()
	r.zoneConfig[zoneID] = configEntry{cfg: cfg, found: found, expiresAt: time.Now().Add(r.ttl)}
	r.mu.Unlock()
	return cfg, found
}

// resolveRules reads zone_rules:{zoneID} (written by the CDN Service's
// RulesConfigPublisher on every rule mutation) and returns them pre-sorted
// highest-priority-first. A missing key or a JSON error yields no rules —
// never blocking config resolution on the rules read.
func (r *RedisRegistry) resolveRules(ctx context.Context, zoneID string) []cacherules.Rule {
	raw, err := r.client.Get(ctx, "zone_rules:"+zoneID).Result()
	if err != nil {
		if !errors.Is(err, redis.Nil) {
			log.Printf("zone: zone_rules lookup error for %q: %v", zoneID, err)
		}
		return nil
	}
	var parsed []redisRule
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		log.Printf("zone: bad zone_rules JSON for %q: %v", zoneID, err)
		return nil
	}
	rules := make([]cacherules.Rule, len(parsed))
	for i, p := range parsed {
		rules[i] = cacherules.Rule{
			Pattern:        p.Pattern,
			PatternType:    p.PatternType,
			Action:         p.Action,
			EdgeTTL:        p.EdgeTTL,
			BrowserTTL:     p.BrowserTTL,
			QueryString:    p.QueryString,
			QueryWhitelist: p.QueryWhitelist,
			Priority:       p.Priority,
		}
	}
	return cacherules.SortByPriorityDesc(rules)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/edge-proxy test:integration -- ./internal/zone/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-proxy/internal/zone
git commit -m "feat(edge-proxy): resolve zone_rules:{id} into Config.Rules"
```

---

### Task 10: `handler.go` — rule-aware cache key, TTL override, bypass, and tag population

**Files:**
- Modify: `apps/edge-proxy/internal/proxy/handler.go`
- Create: `apps/edge-proxy/internal/proxy/handler_cacherules_integration_test.go`

**Interfaces:**
- Consumes: `cacherules.Match` (Task 6), `cachekey.Build`'s new signature (Task 7), `Entry.ZoneID`/`Path`/`Tags`/`BrowserTTL` (Task 8), `zone.Config.Rules` (Task 9).
- Produces: a request whose path matches a `bypass`/`no-store` rule never touches the cache; a matched `cache` rule's `edgeTtl`/`browserTtl` override the origin-header TTL chain; every newly-cached `Entry` carries `ZoneID`, `Path`, and any `Cache-Tag` response header parsed into `Tags`.

- [ ] **Step 1: Write the failing integration tests**

Create `apps/edge-proxy/internal/proxy/handler_cacherules_integration_test.go` (mirror the existing `handler_*_integration_test.go` files' harness for constructing a `CachingHandler` with a fake origin — read one, e.g. `handler_integration_test.go`, first to copy its exact `fakeOrigin`/zone-registry setup):

```go
//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"rivocloud/edge-proxy/internal/cachekey"
	"rivocloud/edge-proxy/internal/cacherules"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func TestHandler_BypassRuleNeverCaches(t *testing.T) {
	origin := &countingOrigin{status: http.StatusOK, body: []byte("dynamic"), headers: http.Header{"Cache-Control": {"max-age=3600"}}}
	edgeTTLZero := 0
	zones := zone.NewStaticRegistry([]zone.Config{{
		ID: "z1", Host: "cdn.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour,
		Rules: []cacherules.Rule{{Pattern: "/api/*", PatternType: "glob", Action: "bypass", EdgeTTL: &edgeTTLZero, Priority: 10}},
	}})
	memory, _ := cachestore.NewMemory(10)
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: origin}

	req := httptest.NewRequest(http.MethodGet, "http://cdn.test/api/users", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://cdn.test/api/users", nil))

	if origin.calls != 2 {
		t.Fatalf("expected a bypass rule to hit the origin every time, got %d calls", origin.calls)
	}
}

func TestHandler_CacheRuleOverridesOriginTTL(t *testing.T) {
	origin := &countingOrigin{status: http.StatusOK, body: []byte("asset"), headers: http.Header{"Cache-Control": {"max-age=5"}}}
	longTTL := 604800
	zones := zone.NewStaticRegistry([]zone.Config{{
		ID: "z1", Host: "cdn.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour,
		Rules: []cacherules.Rule{{Pattern: "/assets/*", PatternType: "glob", Action: "cache", EdgeTTL: &longTTL, Priority: 1}},
	}})
	memory, _ := cachestore.NewMemory(10)
	now := time.Now()
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: origin, Now: func() time.Time { return now }}

	req := httptest.NewRequest(http.MethodGet, "http://cdn.test/assets/app.js", nil)
	h.ServeHTTP(httptest.NewRecorder(), req)

	key := cachekey.Build("z1", "GET", "cdn.test", "/assets/app.js", "", "strip_all", nil)
	entry, ok, err := memory.Get(req.Context(), key)
	if err != nil || !ok {
		t.Fatalf("expected an entry stored under the rule's query mode, got ok=%v err=%v", ok, err)
	}
	if entry.ExpiresAt.Sub(now) < 604800*time.Second-time.Second {
		t.Fatalf("expected the rule's 604800s edgeTtl to override the origin's max-age=5, got expiry in %s", entry.ExpiresAt.Sub(now))
	}
}

func TestHandler_PopulatesZoneIDAndPathAndTagsFromCacheTagHeader(t *testing.T) {
	origin := &countingOrigin{status: http.StatusOK, body: []byte("post"), headers: http.Header{
		"Cache-Control": {"max-age=3600"},
		"Cache-Tag":     {"blog-post-123, feed"},
	}}
	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "cdn.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour}})
	memory, _ := cachestore.NewMemory(10)
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: origin}

	req := httptest.NewRequest(http.MethodGet, "http://cdn.test/posts/1", nil)
	h.ServeHTTP(httptest.NewRecorder(), req)

	key := cachekey.Build("z1", "GET", "cdn.test", "/posts/1", "", "include_all", nil)
	entry, ok, _ := memory.Get(req.Context(), key)
	if !ok {
		t.Fatal("expected an entry to be stored")
	}
	if entry.ZoneID != "z1" || entry.Path != "/posts/1" {
		t.Fatalf("expected ZoneID/Path to be populated, got %+v", entry)
	}
	if len(entry.Tags) != 2 || entry.Tags[0] != "blog-post-123" || entry.Tags[1] != "feed" {
		t.Fatalf("expected Tags parsed from Cache-Tag header, got %+v", entry.Tags)
	}
}
```

(`countingOrigin` should already exist in one of the existing `handler_*_integration_test.go` files as the shared fake `OriginFetcher` — reuse it; if the existing fake is named differently, use that name instead and adjust these tests to match its actual field names.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/edge-proxy test:integration -- ./internal/proxy/...`
Expected: FAIL — bypass rule not honored, TTL not overridden, `Cache-Tag` not parsed.

- [ ] **Step 3: Implement**

In `apps/edge-proxy/internal/proxy/handler.go`, add the import:

```go
	"rivocloud/edge-proxy/internal/cacherules"
```

Replace the top of `ServeHTTP` (from the zone resolution through cache-key construction) with:

```go
func (h *CachingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	z, ok := h.Zones.Resolve(r.Host)
	if !ok {
		http.Error(w, "unknown zone", http.StatusNotFound)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.proxyUncached(w, r, z)
		return
	}

	// A Range request bypasses the cache in both directions. The cache key
	// carries no range, so serving a stored full body would answer the wrong
	// bytes and storing a 206 would poison the full-body entry.
	if r.Header.Get("Range") != "" {
		h.proxyUncached(w, r, z)
		return
	}

	rule, ruleMatched := cacherules.Match(z.Rules, r.URL.Path)
	// A bypass/no-store rule (EDD Section 5.3, Priority 1) means "never
	// cache this," which is exactly what the uncached passthrough path
	// already does — no separate non-caching branch needed.
	if ruleMatched && (rule.Action == "bypass" || rule.Action == "no-store") {
		h.proxyUncached(w, r, z)
		return
	}

	queryMode, queryWhitelist := "include_all", []string(nil)
	if ruleMatched {
		queryMode, queryWhitelist = rule.QueryString, rule.QueryWhitelist
	}
	key := cachekey.Build(z.ID, cachekey.NormalizeMethod(r.Method), r.Host, r.URL.Path, r.URL.RawQuery, queryMode, queryWhitelist)
	now := h.now()

	entry, hitLayerIdx, found := h.lookup(r.Context(), key, now)
	if found && entry.Fresh(now) {
		h.populateFasterLayers(r.Context(), key, entry, hitLayerIdx)
		writeEntry(w, r, h.negotiateEncoding(r, key, entry), now, "HIT")
		return
	}

	etag := ""
	if found {
		etag = entry.ETag
	}
	var ruleTTLOverride *time.Duration
	var ruleBrowserTTLOverride *time.Duration
	if ruleMatched && rule.EdgeTTL != nil {
		d := time.Duration(*rule.EdgeTTL) * time.Second
		ruleTTLOverride = &d
	}
	if ruleMatched && rule.BrowserTTL != nil {
		d := time.Duration(*rule.BrowserTTL) * time.Second
		ruleBrowserTTLOverride = &d
	}
	result, err := h.fetchOrigin(r, z, originRequest{
		method:           http.MethodGet,
		ifNoneMatch:      etag,
		ownsRevalidation: true,
		ttlOverride:      ruleTTLOverride,
	})
	if err != nil {
		if found && entry.UsableAsStale(now) {
			writeEntry(w, r, h.negotiateEncoding(r, key, entry), now, "STALE")
			return
		}
		http.Error(w, "origin unreachable", http.StatusBadGateway)
		return
	}

	if result.notModified {
		if !found {
			// Unreachable once the client's own conditional headers are
			// stripped above: the edge only sends If-None-Match when it has
			// something to revalidate. Refreshing/serving the zero-valued
			// entry here would emit WriteHeader(0) and panic, so fail loudly
			// instead.
			log.Printf("origin returned 304 with nothing cached for key %s", key)
			http.Error(w, "unexpected origin 304", http.StatusBadGateway)
			return
		}
		refreshed := refreshExpiry(entry, result.decision, now)
		refreshed.BrowserTTL = ruleBrowserTTLOverride
		if result.decision.Cacheable {
			h.store(r.Context(), key, refreshed)
		}
		writeEntry(w, r, h.negotiateEncoding(r, key, refreshed), now, "HIT")
		return
	}

	defer result.response.Body.Close()
	body, err := io.ReadAll(result.response.Body)
	if err != nil {
		http.Error(w, "error reading origin response", http.StatusBadGateway)
		return
	}
	newEntry := buildEntry(result.response, body, result.decision, now, z.ID, r.URL.Path)
	newEntry.BrowserTTL = ruleBrowserTTLOverride
	if result.decision.Cacheable {
		h.store(r.Context(), key, newEntry)
	}
	writeEntry(w, r, h.negotiateEncoding(r, key, newEntry), now, "MISS")
}
```

Add `ttlOverride *time.Duration` to `originRequest` and apply it in `fetchOrigin` (after `decision := httpcache.Decide(...)`, both call sites within that function):

```go
type originRequest struct {
	method           string
	ifNoneMatch      string
	ownsRevalidation bool
	// ttlOverride, when set (a matched cache rule's edgeTtl), replaces
	// Decide's origin-header-derived TTL outright — EDD Section 5.3,
	// Priority 1: a cache rule is not a clamp on the origin's own
	// Cache-Control, it supersedes it entirely.
	ttlOverride *time.Duration
}
```

```go
	if resp.StatusCode == http.StatusNotModified {
		decision := httpcache.Decide(resp.Header, z.DefaultTTL, h.now())
		applyTTLOverride(&decision, spec.ttlOverride)
		resp.Body.Close()
		return &originResult{notModified: true, decision: decision}, nil
	}

	decision := httpcache.Decide(resp.Header, z.DefaultTTL, h.now())
	applyTTLOverride(&decision, spec.ttlOverride)
	// Decide only reads freshness directives. Storable applies the gates that
	// no Cache-Control can override — status code, an unhonorable Vary, and
	// an authenticated request without an explicit "public". Zeroing the
	// whole Decision (rather than only its Cacheable flag) also makes
	// writeEntry advertise no-store to the client.
	if decision.Cacheable && !httpcache.Storable(resp.StatusCode, resp.Header, r.Header.Get("Authorization") != "") {
		decision = httpcache.Decision{Cacheable: false}
	}
	return &originResult{response: resp, decision: decision}, nil
}

// applyTTLOverride replaces decision's TTL with override when a cache rule
// matched, leaving StaleIfErrorTTL (not part of any cache_rules field) and
// Cacheable untouched.
func applyTTLOverride(decision *httpcache.Decision, override *time.Duration) {
	if override == nil {
		return
	}
	decision.Cacheable = true
	decision.TTL = *override
	decision.MustRevalidate = false
}
```

Update `buildEntry` to take and populate `zoneID`/`path`, and to parse `Cache-Tag`:

```go
func buildEntry(resp *http.Response, body []byte, decision httpcache.Decision, now time.Time, zoneID, path string) cachestore.Entry {
	header := resp.Header.Clone()
	tags := parseCacheTag(header.Get("Cache-Tag"))
	header.Del("Cache-Control")
	header.Del("Expires")
	header.Del("ETag")
	header.Del("Cache-Tag")
	header.Del("Content-Length")
	header.Del("Connection")
	header.Del("Transfer-Encoding")
	header.Del("Set-Cookie")
	header.Set("Content-Length", strconv.Itoa(len(body)))

	return cachestore.Entry{
		StatusCode: resp.StatusCode,
		Header:     header,
		Body:       body,
		ETag:       resp.Header.Get("ETag"),
		Cacheable:  decision.Cacheable,
		StoredAt:   now,
		ExpiresAt:  now.Add(decision.TTL),
		StaleUntil: now.Add(decision.TTL).Add(decision.StaleIfErrorTTL),
		ZoneID:     zoneID,
		Path:       path,
		Tags:       tags,
	}
}

// parseCacheTag reads the Cache-Tag origin response header (a small,
// deliberately minimal tagging convention — see the plan's Design Decisions
// #1) into a clean tag list.
func parseCacheTag(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	tags := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			tags = append(tags, trimmed)
		}
	}
	return tags
}
```

Update the two call sites of `buildEntry` (the 304-refresh path doesn't call it — only the fresh-body MISS path does, already shown above with `newEntry := buildEntry(result.response, body, result.decision, now, z.ID, r.URL.Path)`).

Finally, update `writeEntry` to honor `entry.BrowserTTL` when set:

```go
func writeEntry(w http.ResponseWriter, r *http.Request, entry cachestore.Entry, now time.Time, source string) {
	for k, vs := range entry.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	remaining := entry.ExpiresAt.Sub(now)
	if entry.BrowserTTL != nil {
		remaining = *entry.BrowserTTL
	}
	w.Header().Set("Cache-Control", httpcache.BrowserCacheControl(httpcache.Decision{Cacheable: entry.Cacheable}, remaining))
	// Announce the edge's own encoding negotiation, but never at the cost of
	// the origin's Vary: a response varying by anything else is relayed with
	// that Vary intact (and is non-cacheable, per httpcache.Storable), so
	// downstream caches don't inherit a claim the origin never made.
	if httpcache.VaryOnlyAcceptEncoding(strings.Join(entry.Header.Values("Vary"), ",")) {
		w.Header().Set("Vary", "Accept-Encoding")
	}
	w.Header().Set("X-RivoCloud-Cache", source)
	if entry.ETag != "" {
		w.Header().Set("ETag", entry.ETag)
	}
	w.WriteHeader(entry.StatusCode)
	if r.Method == http.MethodHead {
		return
	}
	w.Write(entry.Body)
}
```

`gzipVariant` must copy `ZoneID`/`Path`/`Tags`/`BrowserTTL` onto the compressed variant so a purge matches both the identity and gzip entries for the same path — it already does this implicitly (`variant := identity` copies every field), so no change is needed there beyond confirming the assignment still compiles.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/edge-proxy test:integration -- ./internal/proxy/...`
Expected: PASS.

- [ ] **Step 5: Run the full Edge Proxy unit + integration suite**

Run: `pnpm --filter @rivocloud/edge-proxy test:unit && pnpm --filter @rivocloud/edge-proxy test:integration`
Expected: PASS (every existing Stage 3/4 test, unchanged, plus everything new).

- [ ] **Step 6: Commit**

```bash
git add apps/edge-proxy/internal/proxy
git commit -m "feat(edge-proxy): wire cache rules into request handling (bypass, TTL override, tags)"
```

---

### Task 11: `internal/invalidation` — NATS subscriber that purges and replies

**Files:**
- Create: `apps/edge-proxy/internal/invalidation/subscriber.go`
- Test: `apps/edge-proxy/internal/invalidation/subscriber_integration_test.go`

**Interfaces:**
- Consumes: `cachestore.Layer.Purge` (Task 8), `github.com/nats-io/nats.go`.
- Produces: `invalidation.Subscribe(natsURL, datacenter string, layers []cachestore.Layer)` — subscribes to `cache.invalidate.*`, purges every layer for the message's `zoneId`/`patterns`/`tags`, and (if the message carries a reply subject) responds with `{datacenter, keysPurged, durationMs}`.

- [ ] **Step 1: Write the failing integration test**

Create `apps/edge-proxy/internal/invalidation/subscriber_integration_test.go`:

```go
//go:build integration

package invalidation

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/nats-io/nats.go"

	"rivocloud/edge-proxy/internal/cachestore"
)

func natsURL() string {
	if u := os.Getenv("NATS_URL"); u != "" {
		return u
	}
	return "nats://localhost:4222"
}

func TestSubscribe_PurgesLayersAndReplies(t *testing.T) {
	memory, _ := cachestore.NewMemory(10)
	ctx := context.Background()
	_ = memory.Set(ctx, "key-a", cachestore.Entry{ZoneID: "zone-inv-1", Path: "/assets/app.js"})
	_ = memory.Set(ctx, "key-b", cachestore.Entry{ZoneID: "zone-inv-1", Path: "/index.html"})

	Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})

	nc, err := nats.Connect(natsURL())
	if err != nil {
		t.Fatalf("failed to connect a requester: %v", err)
	}
	defer nc.Close()

	payload, _ := json.Marshal(map[string]any{
		"zoneId":         "zone-inv-1",
		"patterns":       []string{"/assets/*"},
		"tags":           []string{},
		"invalidationId": "inv-1",
	})
	msg, err := nc.Request("cache.invalidate.zone-inv-1", payload, 2*time.Second)
	if err != nil {
		t.Fatalf("expected a reply, got error: %v", err)
	}

	var reply struct {
		Datacenter string `json:"datacenter"`
		KeysPurged int    `json:"keysPurged"`
		DurationMs int64  `json:"durationMs"`
	}
	if err := json.Unmarshal(msg.Data, &reply); err != nil {
		t.Fatalf("bad reply JSON: %v", err)
	}
	if reply.Datacenter != "test-dc" || reply.KeysPurged != 1 {
		t.Fatalf("unexpected reply: %+v", reply)
	}

	if _, ok, _ := memory.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged")
	}
	if _, ok, _ := memory.Get(ctx, "key-b"); !ok {
		t.Fatal("expected key-b (different path) to remain")
	}
}

func TestSubscribe_WildcardSubjectMatchesAnyZone(t *testing.T) {
	memory, _ := cachestore.NewMemory(10)
	ctx := context.Background()
	_ = memory.Set(ctx, "key-a", cachestore.Entry{ZoneID: "zone-inv-2", Path: "/logo.png"})

	Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})

	nc, err := nats.Connect(natsURL())
	if err != nil {
		t.Fatalf("failed to connect a requester: %v", err)
	}
	defer nc.Close()

	payload, _ := json.Marshal(map[string]any{"zoneId": "zone-inv-2", "patterns": []string{"/logo.png"}})
	if _, err := nc.Request("cache.invalidate.zone-inv-2", payload, 2*time.Second); err != nil {
		t.Fatalf("expected a reply from the wildcard subscription, got: %v", err)
	}
	if _, ok, _ := memory.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/edge-proxy test:integration -- ./internal/invalidation/...`
Expected: FAIL — package doesn't exist.

- [ ] **Step 3: Implement**

Create `apps/edge-proxy/internal/invalidation/subscriber.go`:

```go
// Package invalidation subscribes the Edge Proxy to the CDN Service's
// cache.invalidate.{zoneId} NATS events (EDD Section 4.4) and purges
// matching entries from every configured cache layer, replying with how
// many keys it purged so the CDN Service can aggregate across every Edge
// Proxy (concept doc Section 2.4's scatter-gather pattern).
package invalidation

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/nats-io/nats.go"

	"rivocloud/edge-proxy/internal/cachestore"
)

type invalidateEvent struct {
	ZoneID         string   `json:"zoneId"`
	Patterns       []string `json:"patterns"`
	Tags           []string `json:"tags"`
	InvalidationID string   `json:"invalidationId"`
}

type invalidateReply struct {
	Datacenter string `json:"datacenter"`
	KeysPurged int    `json:"keysPurged"`
	DurationMs int64  `json:"durationMs"`
}

// Subscribe listens for invalidation events on every zone (a wildcard
// subscription, matching the concept doc Section 2.4: "every Edge Proxy
// subscribes with a wildcard cache.invalidate.* so it hears invalidations
// for all zones it might be caching content for"). Best-effort: if NATS is
// unavailable at startup, this only logs — invalidation degrades to "wait
// for the TTL to expire," never a hard failure of the proxy itself.
func Subscribe(natsURL, datacenter string, layers []cachestore.Layer) {
	nc, err := nats.Connect(natsURL)
	if err != nil {
		log.Printf("invalidation: NATS unavailable, invalidation will not be delivered: %v", err)
		return
	}
	if _, err := nc.Subscribe("cache.invalidate.*", func(msg *nats.Msg) {
		handle(msg, datacenter, layers)
	}); err != nil {
		log.Printf("invalidation: subscribe failed: %v", err)
	}
}

func handle(msg *nats.Msg, datacenter string, layers []cachestore.Layer) {
	start := time.Now()
	var event invalidateEvent
	if err := json.Unmarshal(msg.Data, &event); err != nil {
		log.Printf("invalidation: bad cache.invalidate payload: %v", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	total := 0
	for i, layer := range layers {
		if layer == nil {
			continue
		}
		count, err := layer.Purge(ctx, event.ZoneID, event.Patterns, event.Tags)
		if err != nil {
			log.Printf("invalidation: layer %d purge error for zone %s: %v", i, event.ZoneID, err)
			continue
		}
		total += count
	}

	if msg.Reply == "" {
		return
	}
	reply, err := json.Marshal(invalidateReply{Datacenter: datacenter, KeysPurged: total, DurationMs: time.Since(start).Milliseconds()})
	if err != nil {
		log.Printf("invalidation: failed to marshal reply: %v", err)
		return
	}
	if err := msg.Respond(reply); err != nil {
		log.Printf("invalidation: failed to send reply: %v", err)
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/edge-proxy test:integration -- ./internal/invalidation/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-proxy/internal/invalidation
git commit -m "feat(edge-proxy): add NATS invalidation subscriber with purge-and-reply"
```

---

### Task 12: Wire `invalidation.Subscribe` into `main.go`

**Files:**
- Modify: `apps/edge-proxy/cmd/edge-proxy/main.go`

**Interfaces:**
- Consumes: `invalidation.Subscribe` (Task 11).
- Produces: a running Edge Proxy that subscribes to invalidation events on startup, using a new `EDGE_DATACENTER` env var (default `"local"`) as its reply identity.

- [ ] **Step 1: Implement (no new automated test — this is startup wiring already exercised end-to-end by Task 11's integration tests and manually verified in Step 2 below)**

In `apps/edge-proxy/cmd/edge-proxy/main.go`, add the import:

```go
	"rivocloud/edge-proxy/internal/invalidation"
```

After the existing `configsync.Subscribe(natsURL(), zones)` line, add:

```go
	layers := []cachestore.Layer{
		memory,
		cachestore.NewRedis(redisClient, "edge-proxy:"),
	}
	invalidation.Subscribe(natsURL(), datacenter(), layers)

	handler := &proxy.CachingHandler{
		Zones:  zones,
		Layers: layers,
		Origin: newOriginClient(),
	}
```

(This replaces the prior inline `Layers: []cachestore.Layer{...}` literal inside the `CachingHandler{}` construction — extracting it to a `layers` variable so both `invalidation.Subscribe` and `CachingHandler` share the identical slice.)

Add the `datacenter` helper next to the existing `natsURL`/`l1MaxEntries` helpers:

```go
func datacenter() string {
	if dc := os.Getenv("EDGE_DATACENTER"); dc != "" {
		return dc
	}
	return "local"
}
```

- [ ] **Step 2: Manually verify the wiring compiles and boots**

Run: `pnpm --filter @rivocloud/edge-proxy build`
Expected: builds `dist/edge-proxy` with no errors.

Run: `pnpm --filter @rivocloud/edge-proxy test:unit && pnpm --filter @rivocloud/edge-proxy test:integration`
Expected: PASS (the full suite, confirming `main.go` still compiles alongside every package it imports).

- [ ] **Step 3: Commit**

```bash
git add apps/edge-proxy/cmd/edge-proxy/main.go
git commit -m "feat(edge-proxy): wire invalidation.Subscribe into main"
```

---

### Task 13: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run every affected service's full test suite**

Run:
```bash
pnpm --filter @rivocloud/cdn-service test:unit
pnpm --filter @rivocloud/cdn-service test:integration
pnpm --filter @rivocloud/edge-proxy test:unit
pnpm --filter @rivocloud/edge-proxy test:integration
pnpm --filter @rivocloud/cdn-service typecheck
pnpm --filter @rivocloud/cdn-service lint
pnpm --filter @rivocloud/edge-proxy typecheck
pnpm --filter @rivocloud/edge-proxy lint
```
Expected: PASS across the board.

- [ ] **Step 2: Update the PRD's roadmap status**

In `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`, change row 7's status from "Not started" to "✅ Done", matching the convention already used for rows 1–6.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md
git commit -m "docs: mark Stage 7 done in the PRD"
```

## Self-Review Notes

- **Spec coverage:** EDD 4.4 (invalidation flow) → Tasks 2, 4, 11, 12. EDD 5.2/5.3 (cache key, TTL priority) → Tasks 7, 10. EDD 6.2 (`cache_rules`/`cache_invalidations` schema) → Tasks 3, 4 (both tables already existed; no migration task needed). EDD 7.5 (endpoints) → Tasks 3, 4 match every listed route except `PATCH .../domains` (Stage 8, out of scope) and the two omitted-by-design dashboard-facing concerns. EDD 11.7.1/11.7.2 → Tasks 1–4 (7.1) and Tasks 5–12 (7.2, since rule evaluation touches the Edge Proxy's hot path more than invalidation does). Concept doc Section 5 (tag vs. pattern) → Design Decision 1 and Tasks 8/10/11.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code and exact commands.
- **Type consistency:** `EdgeInvalidationReply`/`invalidateReply` field names (`datacenter`, `keysPurged`, `durationMs`) match across Task 4 (CDN Service consumer) and Task 11 (Edge Proxy producer). `cacherules.Rule` field names match across Task 6 (definition), Task 9 (`redisRule` → `Rule` conversion), and Task 10 (consumption in `handler.go`). `cachekey.Build`'s new signature is consistent across Tasks 7 and 10.
