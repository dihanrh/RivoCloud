# Phase 1 — Stage 4: CDN Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/cdn-service` (NestJS) — zone CRUD (create/read/update/delete) backed by PostgreSQL, publishing every change to Redis as the JSON config the Go Edge Proxy reads on every request — and teach the already-running Edge Proxy (Stage 3) to read that config from Redis instead of its Stage 3 hardcoded demo zone, so a zone created through the API is "actively serving cached traffic... purely because a new Redis key appeared" (concept doc, Section 6), with no restart of either service.

**Architecture:** A new control-plane microservice (`apps/cdn-service`, NestJS) owns `pull_zones` in PostgreSQL and is the only writer of two Redis key families — `zone_config:{zoneId}` (the canonical JSON blob) and `zone_host:{slug}.{CDN_ROOT_DOMAIN}` (a host→zoneId index, needed because the Edge Proxy resolves by Host header, not by ID). Every zone mutation also publishes a `config.zones.updated` NATS event carrying `{ zoneId }`. The data-plane Edge Proxy (Go) never talks to Postgres or to the CDN Service's HTTP API: it gets a new `zone.RedisRegistry` that reads the two Redis key families (with a 60s in-process cache in front, split into a host→id cache and an id→config cache so a NATS nudge can evict precisely the zone that changed) and a small `configsync` package that subscribes to `config.zones.updated` to evict early. Auth is verified over the network: the CDN Service has no JWT keys or API-key table of its own — it calls the Identity Service's existing `POST /internal/auth/verify-token` / `POST /internal/auth/verify-api-key` endpoints (Stage 2, EDD Section 7.9), matching the "Identity Service (auth context validation)" dependency the EDD lists for the CDN Service (Section 2.3).

**Tech Stack:** NestJS 10, Prisma (`@rivocloud/db`, already has the `pull_zones` schema from Stage 1), `ioredis`, `nats` (Node) / `github.com/nats-io/nats.go` (Go), `class-validator`/`class-transformer` for DTOs, Vitest, Go stdlib `net/http` + `github.com/redis/go-redis/v9`.

**Spec:**
- [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.2 (Functional Requirements), Section 7 (Roadmap, Stage 4)
- [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 2.3 (CDN Service responsibilities), Section 7.5 (API), Section 11 (4.1/4.2 development order)
- [`docs/concepts/cdn-zones-and-configuration.md`](../../concepts/cdn-zones-and-configuration.md) — the beginner walkthrough this plan implements end-to-end

## Global Constraints

- API routes are versioned `/api/v1/...` (PRD Non-Functional Requirements, Scalability path).
- Every resource is org-scoped; a caller only ever sees zones belonging to their own `orgId` (PRD Goals: "Reach production-safe multi-tenancy").
- Secrets never leave a service's own boundary: `pull_zones.signing_secret` is never included in an API response, even though nothing populates it until Stage 10.
- The Edge Proxy never queries PostgreSQL and never calls the CDN Service's HTTP API on the hot path — Redis is the only hand-off point (concept doc, Section 4/5).
- Redis is the authoritative config source; NATS is a faster-than-TTL nudge, not a required delivery path (concept doc, Section 4) — a missed or absent NATS message must never break correctness, only latency-of-propagation.
- This dev machine has no native Go toolchain — every Go command in this plan runs through `bash apps/edge-proxy/scripts/go-docker.sh <cmd>`, exactly as Stage 3 established. CI has a native toolchain and the wrapper already degrades to `exec "$@"` there.

## Design Decisions (read before starting)

These resolve ambiguity the source docs leave open. Each is a deliberate, scoped choice — not a placeholder:

1. **No new shared package.** The EDD's Stage 2 "Output: shared auth guard package" was never extracted (Stage 2's plan explicitly deferred it: "once a shared package exists"). With only two services in existence, this plan keeps that deferral: `apps/cdn-service` gets its own small `AuthGuard`/`EventsService`-shaped files rather than a new `packages/*` workspace member. If a third service needs the same pieces, extracting a package then is a small, low-risk refactor with two real call sites to generalize from instead of one imagined one.
2. **Auth is a network call, not a code import.** `apps/identity-service` already exposes `POST /internal/auth/verify-token` and `POST /internal/auth/verify-api-key` (guarded by `X-Internal-Secret`, EDD Section 7.9) for exactly this purpose. `apps/cdn-service` calls them via a small `IdentityClient` instead of duplicating JWT verification or reaching into the `api_keys` table itself.
3. **Redis key scheme extends the concept doc's `zone_config:{zoneId}` with a second key, `zone_host:{host}` → `zoneId`.** The concept doc only specifies the ID-keyed blob, but the Edge Proxy's `zone.Registry` interface resolves by Host header (`Resolve(host string)`), so a host→ID index is required to avoid a Redis SCAN on every request. `host` is `{slug}.{CDN_ROOT_DOMAIN}` (`CDN_ROOT_DOMAIN` defaults to `cdn.rivocloud.dev`).
4. **The Edge Proxy's in-process config cache is split into two maps** — host→zoneId and zoneId→config, each on their own 60s TTL — instead of one host→config map. A `config.zones.updated` NATS message only carries a `zoneId` (a zone's slug/host never changes once created, so there's nothing to invalidate there); splitting the cache lets the NATS handler evict exactly the entry that changed instead of guessing at ambiguity between "which host maps to this zone."
5. **Zone deletion (`DELETE /api/v1/zones/:zoneId`) is in scope.** The beginner concept doc calls out create/read/update as the named Stage 4 deliverable, but EDD Section 7.5 lists `DELETE` as part of the same CDN Service surface, the schema's cascade (`onDelete: Cascade` from `zone_domains`/`cache_rules`/`cache_invalidations`) already supports it safely, and leaving zones permanently un-deletable would be a real product gap. Included.
6. **RBAC:** JWT callers are gated by org role (`read`: owner/admin/developer/viewer; `write`/`delete`: owner/admin/developer). API-key callers are gated by the existing scopes already defined in `apps/identity-service/src/organizations/roles.ts`'s `API_KEY_SCOPES` (`zone:read`, `zone:write`, `zone:delete`) — that file is not imported (Decision 1); the three scope strings are duplicated as literals in `apps/cdn-service`, with a comment pointing at the source of truth. The role↔scope mapping matches `scopesAllowedForRole` exactly (a `developer` role/key can read, write, and delete zones; `viewer` can only read).

## File Structure

```
apps/cdn-service/
  package.json, tsconfig.json, .swcrc, vitest.config.ts, vitest.integration.config.ts
  src/
    main.ts, app.module.ts, env.ts, env.module.ts, app-env.token.ts
    prisma/prisma.module.ts          # copied verbatim from identity-service
    redis/redis.module.ts            # copied verbatim from identity-service
    events/events.service.ts         # copied verbatim from identity-service
    events/events.module.ts          # copied verbatim from identity-service
    health/health.controller.ts
    auth/
      identity-client.ts             # calls identity-service's internal endpoints
      identity-client.provider.ts
      identity-client.test.ts
      auth-context.decorator.ts
      auth-guard.ts
      auth-guard.test.ts
      zone-scope.guard.ts
      zone-scope.guard.test.ts
      auth.module.ts
    zones/
      slug.util.ts
      zone-response.util.ts
      zone-config.publisher.ts
      zone-config.publisher.integration.test.ts
      zones.service.ts
      zones.service.integration.test.ts
      zones.controller.ts
      zones.controller.integration.test.ts
      zones.module.ts
      dto/create-zone.dto.ts, dto/update-zone.dto.ts, dto/list-zones.dto.ts

apps/edge-proxy/
  internal/zone/redis_registry.go, redis_registry_integration_test.go   # new
  internal/configsync/subscriber.go, subscriber_integration_test.go    # new
  cmd/edge-proxy/main.go            # modified: RedisRegistry + configsync.Subscribe
  scripts/go-docker.sh              # modified: NATS_URL passthrough
  go.mod, go.sum                    # modified: + github.com/nats-io/nats.go
```

---

### Task 1: Scaffold `apps/cdn-service`

**Files:**
- Create: `apps/cdn-service/package.json`, `tsconfig.json`, `.swcrc`, `vitest.config.ts`, `vitest.integration.config.ts`
- Create: `apps/cdn-service/src/env.ts`, `env.module.ts`, `app-env.token.ts`, `main.ts`, `app.module.ts`
- Create: `apps/cdn-service/src/prisma/prisma.module.ts`, `src/redis/redis.module.ts`
- Create: `apps/cdn-service/src/events/events.service.ts`, `src/events/events.module.ts`
- Create: `apps/cdn-service/src/health/health.controller.ts`
- Test: `apps/cdn-service/src/health/health.controller.integration.test.ts`

**Interfaces:**
- Consumes: `@rivocloud/db` (`prisma`, `PrismaClient`, `PullZone`), `@rivocloud/config` (`baseEnvSchema`, `validateEnv`) — both already published workspace packages.
- Produces: `AppEnv` (env shape every later task injects via `APP_ENV`), `APP_ENV` DI token, `PRISMA`/`REDIS` DI tokens, `EventsService` (with `publish(subject, payload)` / `getLastPublished<T>(subject)`), a booting NestJS app on `PORT` (default 3003) with `GET /api/v1/health` → `{ status: 'ok' }`.

- [ ] **Step 1: Create `apps/cdn-service/package.json`**

```json
{
  "name": "@rivocloud/cdn-service",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@rivocloud/config": "workspace:*",
    "@rivocloud/db": "workspace:*",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^5.4.1",
    "nats": "^2.28.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.4",
    "@swc/core": "^1.15.46",
    "@types/express": "^4.17.21",
    "@types/node": "^20.16.11",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "unplugin-swc": "^1.5.9",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `apps/cdn-service/tsconfig.json`, `.swcrc`, `vitest.config.ts`, `vitest.integration.config.ts`**

`tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src"]
}
```

`.swcrc` (identical to `apps/identity-service/.swcrc`):
```json
{
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "decorators": true
    },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true
    },
    "target": "es2022",
    "keepClassNames": true
  },
  "module": {
    "type": "es6"
  },
  "sourceMaps": true
}
```

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    passWithNoTests: true,
  },
});
```

`vitest.integration.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 3: Create env handling — `src/app-env.token.ts`, `src/env.ts`, `src/env.module.ts`**

`src/app-env.token.ts`:
```typescript
export const APP_ENV = 'APP_ENV';
```

`src/env.ts`:
```typescript
import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@rivocloud/config';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3003),
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_API_SECRET: z.string().min(16),
  CDN_ROOT_DOMAIN: z.string().min(1).default('cdn.rivocloud.dev'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return validateEnv(envSchema, env);
}
```

`src/env.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { APP_ENV } from './app-env.token.js';
import { loadEnv } from './env.js';

@Global()
@Module({
  providers: [{ provide: APP_ENV, useValue: loadEnv() }],
  exports: [APP_ENV],
})
export class EnvModule {}
```

- [ ] **Step 4: Create `src/prisma/prisma.module.ts` and `src/redis/redis.module.ts` (copied verbatim from `apps/identity-service`)**

`src/prisma/prisma.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { prisma } from '@rivocloud/db';

export const PRISMA = 'PRISMA';

@Global()
@Module({
  providers: [{ provide: PRISMA, useValue: prisma }],
  exports: [PRISMA],
})
export class PrismaModule {}
```

`src/redis/redis.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const REDIS = 'REDIS';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (env: AppEnv) => new Redis(env.REDIS_URL),
      inject: [APP_ENV],
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
```

- [ ] **Step 5: Create `src/events/events.service.ts` and `src/events/events.module.ts` (copied verbatim from `apps/identity-service`)**

`src/events/events.service.ts`:
```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { connect, JSONCodec, type NatsConnection } from 'nats';

@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private readonly codec = JSONCodec();
  private connectionPromise: Promise<NatsConnection | null> | null = null;
  private readonly lastPublished = new Map<string, unknown>();

  constructor(private readonly natsUrl: string) {}

  private async getConnection(): Promise<NatsConnection | null> {
    if (!this.connectionPromise) {
      this.connectionPromise = connect({ servers: this.natsUrl }).catch((error) => {
        this.logger.warn(`NATS unavailable, events will be dropped: ${error.message}`);
        return null;
      });
    }
    return this.connectionPromise;
  }

  async publish(subject: string, payload: unknown): Promise<void> {
    this.lastPublished.set(subject, payload);
    const connection = await this.getConnection();
    if (!connection) {
      return;
    }
    connection.publish(subject, this.codec.encode(payload));
  }

  getLastPublished<T>(subject: string): T | undefined {
    return this.lastPublished.get(subject) as T | undefined;
  }

  async onModuleDestroy() {
    const connection = await this.getConnection();
    await connection?.close();
  }
}
```

`src/events/events.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Global()
@Module({
  providers: [
    {
      provide: EventsService,
      useFactory: (env: AppEnv) => new EventsService(env.NATS_URL),
      inject: [APP_ENV],
    },
  ],
  exports: [EventsService],
})
export class EventsModule {}
```

- [ ] **Step 6: Write the failing test for the health endpoint — `src/health/health.controller.integration.test.ts`**

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module.js';

describe('GET /api/v1/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns status ok', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service install && pnpm --filter @rivocloud/cdn-service run test:integration` (needs `DATABASE_URL`/`REDIS_URL`/`NATS_URL`/`INTERNAL_API_SECRET` in the environment — reuse the same local values `apps/identity-service` uses).
Expected: FAIL — `app.module.js` does not exist yet.

- [ ] **Step 7: Create `src/health/health.controller.ts`, `src/app.module.ts`, `src/main.ts`**

`src/health/health.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';

@Controller('api/v1/health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

`src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, EventsModule],
  controllers: [HealthController],
})
export class AppModule {}
```

`src/main.ts`:
```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadEnv } from './env.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(env.PORT);
  console.log(`cdn-service listening on :${env.PORT}`);
}

bootstrap();
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service run test:integration`
Expected: PASS.

- [ ] **Step 9: Update the pnpm lockfile and confirm the whole monorepo still lints/typechecks**

```bash
pnpm install
pnpm turbo lint typecheck --filter=@rivocloud/cdn-service
```
Expected: PASS, and `pnpm-lock.yaml` now has an entry for `@rivocloud/cdn-service`.

- [ ] **Step 10: Commit**

```bash
git add apps/cdn-service pnpm-lock.yaml
git commit -m "feat: scaffold apps/cdn-service (Stage 4.0)"
```

---

### Task 2: Auth — `IdentityClient` + `AuthGuard`

**Files:**
- Create: `apps/cdn-service/src/auth/identity-client.ts`, `identity-client.provider.ts`
- Create: `apps/cdn-service/src/auth/auth-context.decorator.ts`, `auth-guard.ts`
- Create: `apps/cdn-service/src/auth/auth.module.ts`
- Test: `apps/cdn-service/src/auth/identity-client.test.ts`, `auth-guard.test.ts`

**Interfaces:**
- Consumes: `APP_ENV` (Task 1) for `IDENTITY_SERVICE_URL`/`INTERNAL_API_SECRET`.
- Produces: `CombinedAuthContext` type (`{ type: 'jwt' | 'api_key'; userId: string | null; orgId: string | null; role: string | null; apiKeyId?: string; permissions?: string[] }`), `AuthCtx()` param decorator, `IdentityClient` (`verifyToken(token): Promise<CombinedAuthContext>`, `verifyApiKey(key): Promise<CombinedAuthContext>` — both throw `UnauthorizedException` on failure), `AuthGuard` (sets `request.auth`), all exported from `AuthModule`. Later tasks (3, 5) import `AuthGuard`, `AuthCtx`, `CombinedAuthContext` from this module.

- [ ] **Step 1: Write the failing test for `IdentityClient` — `src/auth/identity-client.test.ts`**

Uses a real local HTTP server (`node:http`) standing in for identity-service's internal endpoints — no network dependency on a real identity-service, no Nest bootstrap:

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { UnauthorizedException } from '@nestjs/common';
import { IdentityClient } from './identity-client.js';

describe('IdentityClient', () => {
  let server: Server;
  let baseUrl: string;
  let lastSecretHeader: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastSecretHeader = req.headers['x-internal-secret'] as string | undefined;
        const parsed = JSON.parse(body || '{}');
        if (req.url === '/internal/auth/verify-token') {
          if (parsed.token === 'valid-token') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ userId: 'u1', orgId: 'o1', role: 'owner' }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Invalid or expired token' }));
          }
        } else if (req.url === '/internal/auth/verify-api-key') {
          if (parsed.apiKey === 'rc_valid') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ userId: 'u1', orgId: 'o1', permissions: ['zone:read'] }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Invalid API key' }));
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a network address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('sends the internal secret header and parses a verified token', async () => {
    const client = new IdentityClient(baseUrl, 'test-secret');
    const identity = await client.verifyToken('valid-token');
    expect(identity).toEqual({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'owner' });
    expect(lastSecretHeader).toBe('test-secret');
  });

  it('throws UnauthorizedException for an invalid token', async () => {
    const client = new IdentityClient(baseUrl, 'test-secret');
    await expect(client.verifyToken('bad-token')).rejects.toThrow(UnauthorizedException);
  });

  it('parses a verified API key with its permissions', async () => {
    const client = new IdentityClient(baseUrl, 'test-secret');
    const identity = await client.verifyApiKey('rc_valid');
    expect(identity).toEqual({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, permissions: ['zone:read'] });
  });

  it('throws UnauthorizedException for an invalid API key', async () => {
    const client = new IdentityClient(baseUrl, 'test-secret');
    await expect(client.verifyApiKey('rc_bad')).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when identity-service is unreachable', async () => {
    const client = new IdentityClient('http://127.0.0.1:1', 'test-secret');
    await expect(client.verifyToken('valid-token')).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service run test:unit`
Expected: FAIL — `identity-client.js` does not exist.

- [ ] **Step 3: Implement `src/auth/auth-context.decorator.ts` and `src/auth/identity-client.ts`**

`src/auth/auth-context.decorator.ts`:
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CombinedAuthContext {
  type: 'jwt' | 'api_key';
  userId: string | null;
  orgId: string | null;
  role: string | null;
  apiKeyId?: string;
  permissions?: string[];
}

export const AuthCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): CombinedAuthContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.auth;
});
```

`src/auth/identity-client.ts`:
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CombinedAuthContext } from './auth-context.decorator.js';

@Injectable()
export class IdentityClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async verifyToken(token: string): Promise<CombinedAuthContext> {
    const body = await this.post('/internal/auth/verify-token', { token }, 'Invalid or expired token');
    return { type: 'jwt', userId: body.userId, orgId: body.orgId, role: body.role };
  }

  async verifyApiKey(apiKey: string): Promise<CombinedAuthContext> {
    const body = await this.post('/internal/auth/verify-api-key', { apiKey }, 'Invalid API key');
    return { type: 'api_key', userId: body.userId, orgId: body.orgId, role: null, permissions: body.permissions };
  }

  private async post(path: string, payload: unknown, failureMessage: string): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': this.internalSecret },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new UnauthorizedException('Identity Service unreachable');
    }
    if (!response.ok) {
      throw new UnauthorizedException(failureMessage);
    }
    return response.json();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service run test:unit`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `AuthGuard` — `src/auth/auth-guard.test.ts`**

A pure unit test against a fake `IdentityClient` (`vi.fn()`), no HTTP, no Nest bootstrap:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth-guard.js';
import type { IdentityClient } from './identity-client.js';

function contextWith(headers: Record<string, string>) {
  const request: any = { headers };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { context, request };
}

describe('AuthGuard', () => {
  it('rejects a request with neither credential, without calling IdentityClient', async () => {
    const identity = { verifyToken: vi.fn(), verifyApiKey: vi.fn() } as unknown as IdentityClient;
    const guard = new AuthGuard(identity);
    const { context } = contextWith({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(identity.verifyToken).not.toHaveBeenCalled();
    expect(identity.verifyApiKey).not.toHaveBeenCalled();
  });

  it('verifies a Bearer token and attaches the result to request.auth', async () => {
    const auth = { type: 'jwt' as const, userId: 'u1', orgId: 'o1', role: 'owner' };
    const identity = { verifyToken: vi.fn().mockResolvedValue(auth), verifyApiKey: vi.fn() } as unknown as IdentityClient;
    const guard = new AuthGuard(identity);
    const { context, request } = contextWith({ authorization: 'Bearer sometoken' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(identity.verifyToken).toHaveBeenCalledWith('sometoken');
    expect(request.auth).toEqual(auth);
  });

  it('verifies an X-API-Key header and attaches the result to request.auth', async () => {
    const auth = { type: 'api_key' as const, userId: null, orgId: 'o1', role: null, permissions: ['zone:read'] };
    const identity = { verifyToken: vi.fn(), verifyApiKey: vi.fn().mockResolvedValue(auth) } as unknown as IdentityClient;
    const guard = new AuthGuard(identity);
    const { context, request } = contextWith({ 'x-api-key': 'rc_sometoken' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(identity.verifyApiKey).toHaveBeenCalledWith('rc_sometoken');
    expect(request.auth).toEqual(auth);
  });

  it('propagates an IdentityClient rejection', async () => {
    const identity = {
      verifyToken: vi.fn().mockRejectedValue(new UnauthorizedException('Invalid or expired token')),
      verifyApiKey: vi.fn(),
    } as unknown as IdentityClient;
    const guard = new AuthGuard(identity);
    const { context } = contextWith({ authorization: 'Bearer badtoken' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service run test:unit`
Expected: FAIL — `auth-guard.js` does not exist.

- [ ] **Step 7: Implement `src/auth/auth-guard.ts`, `src/auth/identity-client.provider.ts`, `src/auth/auth.module.ts`**

`src/auth/auth-guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityClient } from './identity-client.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly identity: IdentityClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    const authHeader = request.headers['authorization'] as string | undefined;

    if (apiKeyHeader?.startsWith('rc_')) {
      request.auth = await this.identity.verifyApiKey(apiKeyHeader);
      return true;
    }

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization bearer token or X-API-Key header');
    }
    request.auth = await this.identity.verifyToken(authHeader.slice('Bearer '.length));
    return true;
  }
}
```

`src/auth/identity-client.provider.ts`:
```typescript
import { Provider } from '@nestjs/common';
import { IdentityClient } from './identity-client.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const identityClientProvider: Provider = {
  provide: IdentityClient,
  useFactory: (env: AppEnv) => new IdentityClient(env.IDENTITY_SERVICE_URL, env.INTERNAL_API_SECRET),
  inject: [APP_ENV],
};
```

`src/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { identityClientProvider } from './identity-client.provider.js';
import { AuthGuard } from './auth-guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service run test:unit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/cdn-service/src/auth
git commit -m "feat: verify JWTs and API keys against identity-service's internal endpoints"
```

---

### Task 3: RBAC — `ZoneScopeGuard` + `RequireZoneScope`

**Files:**
- Create: `apps/cdn-service/src/auth/zone-scope.guard.ts`
- Test: `apps/cdn-service/src/auth/zone-scope.guard.test.ts`
- Modify: `apps/cdn-service/src/auth/auth.module.ts` (register + export `ZoneScopeGuard`)

**Interfaces:**
- Consumes: `CombinedAuthContext` (Task 2).
- Produces: `ZoneAction = 'read' | 'write' | 'delete'`, `RequireZoneScope(action)` method decorator, `ZoneScopeGuard` (throws `ForbiddenException` when the role/scope doesn't allow `action`). Task 5's controller applies `@RequireZoneScope(...)` per-route alongside `@UseGuards(AuthGuard, ZoneScopeGuard)`.

- [ ] **Step 1: Write the failing test — `src/auth/zone-scope.guard.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ZoneScopeGuard } from './zone-scope.guard.js';
import type { CombinedAuthContext } from './auth-context.decorator.js';

function contextWith(auth: CombinedAuthContext, action: string | undefined) {
  const reflector = { get: () => action } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('ZoneScopeGuard', () => {
  it('allows any request when the handler has no @RequireZoneScope', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, undefined);
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows a developer JWT to write', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'developer' };
    const { context, reflector } = contextWith(auth, 'write');
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects a viewer JWT trying to write', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'write');
    expect(() => new ZoneScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows any JWT role to read', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'read');
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows an API key with the zone:read scope to read', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['zone:read'] };
    const { context, reflector } = contextWith(auth, 'read');
    expect(new ZoneScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects an API key missing the zone:delete scope', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['zone:read'] };
    const { context, reflector } = contextWith(auth, 'delete');
    expect(() => new ZoneScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service run test:unit`
Expected: FAIL — `zone-scope.guard.js` does not exist.

- [ ] **Step 3: Implement `src/auth/zone-scope.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CombinedAuthContext } from './auth-context.decorator.js';

export type ZoneAction = 'read' | 'write' | 'delete';
export const ZONE_SCOPE_KEY = 'zoneScope';
export const RequireZoneScope = (action: ZoneAction) => SetMetadata(ZONE_SCOPE_KEY, action);

// Mirrors apps/identity-service/src/organizations/roles.ts's API_KEY_SCOPES /
// scopesAllowedForRole. Duplicated rather than imported across the service
// boundary (see the plan's Design Decisions, #1/#6) — keep these two in sync
// by hand until a third consumer justifies a shared package.
const ROLES_BY_ACTION: Record<ZoneAction, string[]> = {
  read: ['owner', 'admin', 'developer', 'viewer'],
  write: ['owner', 'admin', 'developer'],
  delete: ['owner', 'admin', 'developer'],
};

@Injectable()
export class ZoneScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const action = this.reflector.get<ZoneAction | undefined>(ZONE_SCOPE_KEY, context.getHandler());
    if (!action) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const auth: CombinedAuthContext = request.auth;

    if (auth.type === 'api_key') {
      const required = `zone:${action}`;
      if (!auth.permissions?.includes(required)) {
        throw new ForbiddenException(`API key is missing the "${required}" scope`);
      }
      return true;
    }

    const allowed = ROLES_BY_ACTION[action];
    if (!auth.role || !allowed.includes(auth.role)) {
      throw new ForbiddenException(`Requires one of roles: ${allowed.join(', ')}`);
    }
    return true;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service run test:unit`
Expected: PASS.

- [ ] **Step 5: Register `ZoneScopeGuard` in `src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { identityClientProvider } from './identity-client.provider.js';
import { AuthGuard } from './auth-guard.js';
import { ZoneScopeGuard } from './zone-scope.guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard, ZoneScopeGuard],
  exports: [AuthGuard, ZoneScopeGuard],
})
export class AuthModule {}
```

- [ ] **Step 6: Commit**

```bash
git add apps/cdn-service/src/auth
git commit -m "feat: gate zone endpoints by org role (JWT) or scope (API key)"
```

---

### Task 4: Zone CRUD service

**Files:**
- Create: `apps/cdn-service/src/zones/slug.util.ts`, `zone-response.util.ts`, `zones.service.ts`
- Test: `apps/cdn-service/src/zones/zones.service.integration.test.ts`

**Interfaces:**
- Consumes: `PRISMA` token (Task 1), `PullZone` type from `@rivocloud/db`.
- Produces: `ZonesService` with `create(orgId, dto)`, `list(orgId, skip, take)`, `getForOrg(orgId, zoneId)`, `update(orgId, zoneId, dto)`, `remove(orgId, zoneId)` — all throw `NotFoundException` for a zone outside the caller's org (never leaks existence). `toZoneResponse(zone)` strips `signingSecret`. This constructor signature (`(db)`) is extended in Task 6 to `(db, publisher)` — Task 5's controller and this task's own test only depend on the methods above, not the constructor arity.

- [ ] **Step 1: Write the failing test — `src/zones/zones.service.integration.test.ts`**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma } from '@rivocloud/db';
import { ZonesService } from './zones.service.js';

async function seedOrg() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Zone Owner' } });
  return prisma.organization.create({ data: { name: 'Zone Org', slug: `zone-org-${randomUUID()}`, ownerId: user.id } });
}

describe('ZonesService', () => {
  const service = new ZonesService(prisma);

  beforeEach(async () => {
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a zone with a generated slug and Stage 4 defaults', async () => {
    const org = await seedOrg();
    const zone = await service.create(org.id, { name: 'My Blog', originUrl: 'https://api.example.com' });

    expect(zone.name).toBe('My Blog');
    expect(zone.slug).toBe('my-blog');
    expect(zone.originUrl).toBe('https://api.example.com');
    expect(zone.originProtocol).toBe('https');
    expect(zone.cacheTtl).toBe(3600);
    expect(zone.browserTtl).toBe(0);
    expect(zone.enabled).toBe(true);
    expect(zone).not.toHaveProperty('signingSecret');
  });

  it('disambiguates a slug collision within the same org', async () => {
    const org = await seedOrg();
    await service.create(org.id, { name: 'My Blog', originUrl: 'https://a.example.com' });
    const second = await service.create(org.id, { name: 'My Blog', originUrl: 'https://b.example.com' });
    expect(second.slug).toBe('my-blog-1');
  });

  it('allows the same slug to be reused in a different org', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await service.create(orgA.id, { name: 'My Blog', originUrl: 'https://a.example.com' });
    const zoneB = await service.create(orgB.id, { name: 'My Blog', originUrl: 'https://b.example.com' });
    expect(zoneB.slug).toBe('my-blog');
  });

  it('lists only the calling org zones, paginated, newest first', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await service.create(orgA.id, { name: 'A1', originUrl: 'https://a1.example.com' });
    await service.create(orgA.id, { name: 'A2', originUrl: 'https://a2.example.com' });
    await service.create(orgB.id, { name: 'B1', originUrl: 'https://b1.example.com' });

    const page = await service.list(orgA.id, 0, 1);
    expect(page.total).toBe(2);
    expect(page.zones).toHaveLength(1);
    expect(page.zones[0].name).toBe('A2');
  });

  it('rejects getForOrg/update/remove on a zone belonging to a different org', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const zone = await service.create(orgA.id, { name: 'A1', originUrl: 'https://a1.example.com' });

    await expect(service.getForOrg(orgB.id, zone.id)).rejects.toThrow(NotFoundException);
    await expect(service.update(orgB.id, zone.id, { name: 'Hijacked' })).rejects.toThrow(NotFoundException);
    await expect(service.remove(orgB.id, zone.id)).rejects.toThrow(NotFoundException);
  });

  it('updates only the fields provided', async () => {
    const org = await seedOrg();
    const zone = await service.create(org.id, { name: 'A1', originUrl: 'https://a1.example.com' });
    const updated = await service.update(org.id, zone.id, { cacheTtl: 60 });
    expect(updated.cacheTtl).toBe(60);
    expect(updated.originUrl).toBe('https://a1.example.com');
  });

  it('removes a zone', async () => {
    const org = await seedOrg();
    const zone = await service.create(org.id, { name: 'A1', originUrl: 'https://a1.example.com' });
    await service.remove(org.id, zone.id);
    await expect(service.getForOrg(org.id, zone.id)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service run test:integration`
Expected: FAIL — `zones.service.js` does not exist.

- [ ] **Step 3: Implement `src/zones/slug.util.ts`, `zone-response.util.ts`, `zones.service.ts`**

`src/zones/slug.util.ts` (identical algorithm to `apps/identity-service/src/organizations/slug.util.ts`):
```typescript
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

`src/zones/zone-response.util.ts`:
```typescript
import type { PullZone } from '@rivocloud/db';

export type ZoneResponse = Omit<PullZone, 'signingSecret'>;

export function toZoneResponse(zone: PullZone): ZoneResponse {
  const { signingSecret: _signingSecret, ...rest } = zone;
  return rest;
}
```

`src/zones/zones.service.ts`:
```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, PullZone } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { slugify } from './slug.util.js';
import { toZoneResponse } from './zone-response.util.js';
import type { CreateZoneDto } from './dto/create-zone.dto.js';
import type { UpdateZoneDto } from './dto/update-zone.dto.js';

@Injectable()
export class ZonesService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async create(orgId: string, dto: CreateZoneDto) {
    const slug = await this.uniqueSlug(orgId, dto.name);
    const zone = await this.db.pullZone.create({
      data: {
        orgId,
        name: dto.name,
        slug,
        originUrl: dto.originUrl,
        originProtocol: dto.originProtocol ?? 'https',
        cacheTtl: dto.cacheTtl ?? 3600,
        browserTtl: dto.browserTtl ?? 0,
      },
    });
    return toZoneResponse(zone);
  }

  async list(orgId: string, skip: number, take: number) {
    const [zones, total] = await Promise.all([
      this.db.pullZone.findMany({ where: { orgId }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.pullZone.count({ where: { orgId } }),
    ]);
    return { zones: zones.map(toZoneResponse), total };
  }

  async getForOrg(orgId: string, zoneId: string) {
    return toZoneResponse(await this.findOwned(orgId, zoneId));
  }

  async update(orgId: string, zoneId: string, dto: UpdateZoneDto) {
    await this.findOwned(orgId, zoneId);
    const zone = await this.db.pullZone.update({
      where: { id: zoneId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.originUrl !== undefined && { originUrl: dto.originUrl }),
        ...(dto.originProtocol !== undefined && { originProtocol: dto.originProtocol }),
        ...(dto.cacheTtl !== undefined && { cacheTtl: dto.cacheTtl }),
        ...(dto.browserTtl !== undefined && { browserTtl: dto.browserTtl }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      },
    });
    return toZoneResponse(zone);
  }

  async remove(orgId: string, zoneId: string): Promise<void> {
    await this.findOwned(orgId, zoneId);
    await this.db.pullZone.delete({ where: { id: zoneId } });
  }

  private async findOwned(orgId: string, zoneId: string): Promise<PullZone> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== orgId) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }

  private async uniqueSlug(orgId: string, name: string): Promise<string> {
    const base = slugify(name) || 'zone';
    let slug = base;
    let attempt = 0;
    while (await this.db.pullZone.findUnique({ where: { orgId_slug: { orgId, slug } } })) {
      attempt += 1;
      slug = `${base}-${attempt}`;
    }
    return slug;
  }
}
```

This references `./dto/create-zone.dto.js` and `./dto/update-zone.dto.js`, which Task 5 creates — add minimal placeholders now so this task's test can run standalone:

`src/zones/dto/create-zone.dto.ts`:
```typescript
export class CreateZoneDto {
  name!: string;
  originUrl!: string;
  originProtocol?: string;
  cacheTtl?: number;
  browserTtl?: number;
}
```

`src/zones/dto/update-zone.dto.ts`:
```typescript
export class UpdateZoneDto {
  name?: string;
  originUrl?: string;
  originProtocol?: string;
  cacheTtl?: number;
  browserTtl?: number;
  enabled?: boolean;
}
```

(Task 5 adds `class-validator` decorators to these same two files — this task only needs their shape.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service run test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cdn-service/src/zones
git commit -m "feat: zone CRUD service with org-scoped ownership checks"
```

---

### Task 5: Zone CRUD controller + DTOs

**Files:**
- Modify: `apps/cdn-service/src/zones/dto/create-zone.dto.ts`, `dto/update-zone.dto.ts` (add validation)
- Create: `apps/cdn-service/src/zones/dto/list-zones.dto.ts`
- Create: `apps/cdn-service/src/zones/zones.controller.ts`, `zones.module.ts`
- Modify: `apps/cdn-service/src/app.module.ts` (import `ZonesModule`)
- Test: `apps/cdn-service/src/zones/zones.controller.integration.test.ts`

**Interfaces:**
- Consumes: `AuthGuard`, `ZoneScopeGuard`, `RequireZoneScope`, `AuthCtx`, `CombinedAuthContext` (Tasks 2–3); `ZonesService` (Task 4).
- Produces: `POST /api/v1/zones`, `GET /api/v1/zones`, `GET /api/v1/zones/:zoneId`, `PATCH /api/v1/zones/:zoneId`, `DELETE /api/v1/zones/:zoneId` per EDD Section 7.5.

- [ ] **Step 1: Add validation to the DTOs**

`src/zones/dto/create-zone.dto.ts`:
```typescript
import { IsIn, IsInt, IsOptional, IsUrl, Min, MinLength, IsString } from 'class-validator';

export class CreateZoneDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  originUrl!: string;

  @IsOptional()
  @IsIn(['http', 'https', 'match'])
  originProtocol?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  cacheTtl?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  browserTtl?: number;
}
```

`src/zones/dto/update-zone.dto.ts`:
```typescript
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Min, MinLength } from 'class-validator';

export class UpdateZoneDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) originUrl?: string;
  @IsOptional() @IsIn(['http', 'https', 'match']) originProtocol?: string;
  @IsOptional() @IsInt() @Min(0) cacheTtl?: number;
  @IsOptional() @IsInt() @Min(0) browserTtl?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
```

`src/zones/dto/list-zones.dto.ts`:
```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListZonesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}
```

- [ ] **Step 2: Write the failing test — `src/zones/zones.controller.integration.test.ts`**

Boots the real `AppModule` (real Postgres/Redis/NATS) but overrides `IdentityClient` with a test double, so the test controls the caller's org/role without a running identity-service:

```typescript
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

describe('ZonesController', () => {
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
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedOrgAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Zone Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    return org;
  }

  it('rejects a request with no credential', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/zones');
    expect(response.status).toBe(401);
  });

  it("creates a zone for the caller's org and hides signingSecret", async () => {
    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Blog', originUrl: 'https://api.example.com' });

    expect(response.status).toBe(201);
    expect(response.body.slug).toBe('my-blog');
    expect(response.body).not.toHaveProperty('signingSecret');
  });

  it('rejects a viewer trying to create a zone', async () => {
    await seedOrgAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Blog', originUrl: 'https://api.example.com' });
    expect(response.status).toBe(403);
  });

  it('rejects an invalid originUrl', async () => {
    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Blog', originUrl: 'not-a-url' });
    expect(response.status).toBe(400);
  });

  it('does not leak a zone across organizations', async () => {
    await seedOrgAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'A1', originUrl: 'https://a1.example.com' });

    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .get(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(404);
  });

  it('updates and deletes a zone', async () => {
    await seedOrgAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'A1', originUrl: 'https://a1.example.com' });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever')
      .send({ cacheTtl: 60 });
    expect(updated.status).toBe(200);
    expect(updated.body.cacheTtl).toBe(60);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);

    const getAfterDelete = await request(app.getHttpServer())
      .get(`/api/v1/zones/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(getAfterDelete.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service run test:integration`
Expected: FAIL — `zones.controller.js` does not exist.

- [ ] **Step 4: Implement `src/zones/zones.controller.ts` and `src/zones/zones.module.ts`**

`src/zones/zones.controller.ts`:
```typescript
import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireZoneScope, ZoneScopeGuard } from '../auth/zone-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { ZonesService } from './zones.service.js';
import { CreateZoneDto } from './dto/create-zone.dto.js';
import { UpdateZoneDto } from './dto/update-zone.dto.js';
import { ListZonesDto } from './dto/list-zones.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/zones')
@UseGuards(AuthGuard, ZoneScopeGuard)
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Post()
  @RequireZoneScope('write')
  create(@AuthCtx() auth: CombinedAuthContext, @Body() dto: CreateZoneDto) {
    return this.zones.create(requireOrgId(auth), dto);
  }

  @Get()
  @RequireZoneScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Query() query: ListZonesDto) {
    return this.zones.list(requireOrgId(auth), query.skip ?? 0, query.take ?? 50);
  }

  @Get(':zoneId')
  @RequireZoneScope('read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.zones.getForOrg(requireOrgId(auth), zoneId);
  }

  @Patch(':zoneId')
  @RequireZoneScope('write')
  update(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: UpdateZoneDto) {
    return this.zones.update(requireOrgId(auth), zoneId, dto);
  }

  @Delete(':zoneId')
  @RequireZoneScope('delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    await this.zones.remove(requireOrgId(auth), zoneId);
    return { success: true };
  }
}
```

`src/zones/zones.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ZonesController } from './zones.controller.js';
import { ZonesService } from './zones.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [ZonesController],
  providers: [ZonesService],
})
export class ZonesModule {}
```

- [ ] **Step 5: Import `ZonesModule` in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { ZonesModule } from './zones/zones.module.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, EventsModule, ZonesModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service run test:integration`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cdn-service/src
git commit -m "feat: expose zone CRUD over /api/v1/zones, gated by role/scope"
```

---

### Task 6: Zone config propagation — Redis publish + NATS notify

**Files:**
- Create: `apps/cdn-service/src/zones/zone-config.publisher.ts`
- Test: `apps/cdn-service/src/zones/zone-config.publisher.integration.test.ts`
- Modify: `apps/cdn-service/src/zones/zones.service.ts` (call the publisher after create/update/remove)
- Modify: `apps/cdn-service/src/zones/zones.service.integration.test.ts` (construct `ZonesService` with a real publisher)
- Modify: `apps/cdn-service/src/zones/zones.module.ts` (register `ZoneConfigPublisher`)

**Interfaces:**
- Consumes: `REDIS` token, `APP_ENV` (`CDN_ROOT_DOMAIN`), `EventsService` (Task 1); `PullZone` (Task 4).
- Produces: `ZoneConfigPublisher.publish(zone)` (writes `zone_config:{id}` + `zone_host:{slug}.{CDN_ROOT_DOMAIN}`, publishes `config.zones.updated`), `.unpublish(zone)` (deletes both keys, publishes the same event). This is what Task 7/8's Go registry reads.

- [ ] **Step 1: Write the failing test — `src/zones/zone-config.publisher.integration.test.ts`**

```typescript
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { EventsService } from '../events/events.service.js';
import { ZoneConfigPublisher } from './zone-config.publisher.js';
import type { AppEnv } from '../env.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const publisher = new ZoneConfigPublisher(redis, { CDN_ROOT_DOMAIN: 'cdn.rivocloud.dev' } as AppEnv, events);

async function seedZone() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  return prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: 'my-blog', originUrl: 'https://api.example.com' },
  });
}

describe('ZoneConfigPublisher', () => {
  beforeEach(async () => {
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('writes zone_config:{id} and zone_host:{slug}.{rootDomain} to Redis', async () => {
    const zone = await seedZone();
    await publisher.publish(zone);

    const config = JSON.parse((await redis.get(`zone_config:${zone.id}`)) ?? '{}');
    expect(config).toMatchObject({ id: zone.id, originUrl: 'https://api.example.com', cacheTtl: 3600, enabled: true });
    expect(await redis.get('zone_host:my-blog.cdn.rivocloud.dev')).toBe(zone.id);
  });

  it('publishes a config.zones.updated NATS event carrying the zoneId', async () => {
    const zone = await seedZone();
    await publisher.publish(zone);
    expect(events.getLastPublished('config.zones.updated')).toEqual({ zoneId: zone.id });
  });

  it('deletes both Redis keys on unpublish', async () => {
    const zone = await seedZone();
    await publisher.publish(zone);
    await publisher.unpublish(zone);

    expect(await redis.get(`zone_config:${zone.id}`)).toBeNull();
    expect(await redis.get('zone_host:my-blog.cdn.rivocloud.dev')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service run test:integration`
Expected: FAIL — `zone-config.publisher.js` does not exist.

- [ ] **Step 3: Implement `src/zones/zone-config.publisher.ts`**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PullZone } from '@rivocloud/db';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { EventsService } from '../events/events.service.js';

@Injectable()
export class ZoneConfigPublisher {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly events: EventsService,
  ) {}

  async publish(zone: PullZone): Promise<void> {
    const config = {
      id: zone.id,
      orgId: zone.orgId,
      slug: zone.slug,
      originUrl: zone.originUrl,
      originProtocol: zone.originProtocol,
      cacheTtl: zone.cacheTtl,
      browserTtl: zone.browserTtl,
      enabled: zone.enabled,
    };
    await this.redis.set(`zone_config:${zone.id}`, JSON.stringify(config));
    await this.redis.set(`zone_host:${this.hostFor(zone)}`, zone.id);
    await this.events.publish('config.zones.updated', { zoneId: zone.id });
  }

  async unpublish(zone: PullZone): Promise<void> {
    await this.redis.del(`zone_config:${zone.id}`, `zone_host:${this.hostFor(zone)}`);
    await this.events.publish('config.zones.updated', { zoneId: zone.id });
  }

  private hostFor(zone: PullZone): string {
    return `${zone.slug}.${this.env.CDN_ROOT_DOMAIN}`;
  }
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service run test:integration`
Expected: PASS for `zone-config.publisher.integration.test.ts`.

- [ ] **Step 5: Wire the publisher into `ZonesService` — modify `src/zones/zones.service.ts`**

Change the constructor and the three mutating methods:

```typescript
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly publisher: ZoneConfigPublisher,
  ) {}
```

Add the import: `import { ZoneConfigPublisher } from './zone-config.publisher.js';`

In `create`, after the `db.pullZone.create` call and before `return toZoneResponse(zone)`:
```typescript
    await this.publisher.publish(zone);
```

In `update`, after the `db.pullZone.update` call and before `return toZoneResponse(zone)`:
```typescript
    await this.publisher.publish(zone);
```

In `remove`, capture the zone from `findOwned` (already done) and unpublish after the delete:
```typescript
  async remove(orgId: string, zoneId: string): Promise<void> {
    const zone = await this.findOwned(orgId, zoneId);
    await this.db.pullZone.delete({ where: { id: zoneId } });
    await this.publisher.unpublish(zone);
  }
```

- [ ] **Step 6: Update the Task 4 test's instantiation — modify `src/zones/zones.service.integration.test.ts`**

Replace `const service = new ZonesService(prisma);` with a real publisher, matching Step 1's fixture:

```typescript
import { Redis } from 'ioredis';
import { EventsService } from '../events/events.service.js';
import { ZoneConfigPublisher } from './zone-config.publisher.js';
import type { AppEnv } from '../env.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const publisher = new ZoneConfigPublisher(redis, { CDN_ROOT_DOMAIN: 'cdn.rivocloud.dev' } as AppEnv, events);
const service = new ZonesService(prisma, publisher);
```

- [ ] **Step 7: Register `ZoneConfigPublisher` in `src/zones/zones.module.ts`**

```typescript
@Module({
  imports: [AuthModule],
  controllers: [ZonesController],
  providers: [ZonesService, ZoneConfigPublisher],
})
export class ZonesModule {}
```
(add `import { ZoneConfigPublisher } from './zone-config.publisher.js';`)

- [ ] **Step 8: Run the full integration suite to verify everything still passes**

Run: `pnpm --filter @rivocloud/cdn-service run test:integration`
Expected: PASS — Task 4's and Task 5's tests still pass (their assertions were about CRUD/HTTP behavior, unaffected by the new side effect), plus the new publisher tests.

- [ ] **Step 9: Commit**

```bash
git add apps/cdn-service/src
git commit -m "feat: publish zone config to Redis and NATS on every zone mutation (Stage 4.2)"
```

---

### Task 7: Edge Proxy — Redis-backed zone Registry (Go)

**Files:**
- Create: `apps/edge-proxy/internal/zone/redis_registry.go`
- Test: `apps/edge-proxy/internal/zone/redis_registry_integration_test.go`

**Interfaces:**
- Consumes: `*redis.Client` (`github.com/redis/go-redis/v9`, already a dependency); the `zone_config:{id}` / `zone_host:{host}` keys Task 6 writes.
- Produces: `zone.RedisRegistry` implementing the existing `zone.Registry` interface (`Resolve(host string) (Config, bool)`), plus `EvictZone(zoneID string)` for Task 8's NATS subscriber to call.

- [ ] **Step 1: Write the failing test — `apps/edge-proxy/internal/zone/redis_registry_integration_test.go`**

```go
//go:build integration

package zone

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func newTestRedisClient(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("invalid REDIS_URL %q: %v", url, err)
	}
	client := redis.NewClient(opts)
	t.Cleanup(func() { client.Close() })
	return client
}

func seedZoneConfig(t *testing.T, client *redis.Client, host, zoneID string, cfg redisConfig) {
	t.Helper()
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := client.Set(ctx, "zone_host:"+host, zoneID, 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.Set(ctx, "zone_config:"+zoneID, raw, 0).Err(); err != nil {
		t.Fatal(err)
	}
}

func TestRedisRegistry_ResolvesAHostPublishedByTheCDNService(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "my-blog.cdn.rivocloud.dev", "zone-1", redisConfig{
		ID: "zone-1", Slug: "my-blog", OriginURL: "https://api.example.com",
		OriginProtocol: "https", CacheTTL: 3600, Enabled: true,
	})

	registry := NewRedisRegistry(client)
	cfg, ok := registry.Resolve("my-blog.cdn.rivocloud.dev:8888")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if cfg.ID != "zone-1" || cfg.OriginURL != "https://api.example.com" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if cfg.DefaultTTL != 3600*time.Second {
		t.Fatalf("expected DefaultTTL 3600s, got %s", cfg.DefaultTTL)
	}
}

func TestRedisRegistry_UnknownHostNotFound(t *testing.T) {
	client := newTestRedisClient(t)
	registry := NewRedisRegistry(client)

	_, ok := registry.Resolve("nobody.cdn.rivocloud.dev")
	if ok {
		t.Fatal("expected unknown host to not resolve")
	}
}

func TestRedisRegistry_DisabledZoneNotFound(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "disabled.cdn.rivocloud.dev", "zone-2", redisConfig{
		ID: "zone-2", Slug: "disabled", OriginURL: "https://api.example.com", Enabled: false,
	})

	registry := NewRedisRegistry(client)
	_, ok := registry.Resolve("disabled.cdn.rivocloud.dev")
	if ok {
		t.Fatal("expected a disabled zone to not resolve")
	}
}

func TestRedisRegistry_CachesForSixtySecondsThenRereadsRedisOnEvict(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "cached.cdn.rivocloud.dev", "zone-3", redisConfig{
		ID: "zone-3", Slug: "cached", OriginURL: "https://old.example.com", CacheTTL: 60, Enabled: true,
	})

	registry := NewRedisRegistry(client)
	first, ok := registry.Resolve("cached.cdn.rivocloud.dev")
	if !ok || first.OriginURL != "https://old.example.com" {
		t.Fatalf("expected first resolve to see the seeded origin, got %+v ok=%v", first, ok)
	}

	seedZoneConfig(t, client, "cached.cdn.rivocloud.dev", "zone-3", redisConfig{
		ID: "zone-3", Slug: "cached", OriginURL: "https://new.example.com", CacheTTL: 60, Enabled: true,
	})
	second, _ := registry.Resolve("cached.cdn.rivocloud.dev")
	if second.OriginURL != "https://old.example.com" {
		t.Fatalf("expected the 60s in-process cache to still serve the old origin, got %s", second.OriginURL)
	}

	registry.EvictZone("zone-3")
	third, ok := registry.Resolve("cached.cdn.rivocloud.dev")
	if !ok || third.OriginURL != "https://new.example.com" {
		t.Fatalf("expected EvictZone to force a re-read, got %+v ok=%v", third, ok)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash apps/edge-proxy/scripts/go-docker.sh go test -tags=integration ./internal/zone/...`
Expected: FAIL to compile — `redisConfig`, `NewRedisRegistry` undefined.

- [ ] **Step 3: Implement `apps/edge-proxy/internal/zone/redis_registry.go`**

```go
package zone

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// redisConfig mirrors the JSON the CDN Service writes to zone_config:{id}
// (docs/concepts/cdn-zones-and-configuration.md Section 4).
type redisConfig struct {
	ID             string `json:"id"`
	Slug           string `json:"slug"`
	OriginURL      string `json:"originUrl"`
	OriginProtocol string `json:"originProtocol"`
	CacheTTL       int    `json:"cacheTtl"`
	BrowserTTL     int    `json:"browserTtl"`
	Enabled        bool   `json:"enabled"`
}

type hostEntry struct {
	zoneID    string
	found     bool
	expiresAt time.Time
}

type configEntry struct {
	cfg       Config
	found     bool
	expiresAt time.Time
}

// RedisRegistry resolves a Host header to a zone Config by reading the
// zone_host:{host} -> zone_config:{id} pair the CDN Service publishes
// (concept doc Section 4/5). Two independent 60s in-process caches sit in
// front of Redis — host->zoneID and zoneID->config — so the hot path never
// pays a Redis round-trip on every request, and a config.zones.updated NATS
// nudge (Task 8) can evict exactly the zone that changed by ID, without
// needing to know which host(s) map to it.
type RedisRegistry struct {
	client *redis.Client
	ttl    time.Duration

	mu           sync.RWMutex
	hostToZoneID map[string]hostEntry
	zoneConfig   map[string]configEntry
}

func NewRedisRegistry(client *redis.Client) *RedisRegistry {
	return &RedisRegistry{
		client:       client,
		ttl:          60 * time.Second,
		hostToZoneID: make(map[string]hostEntry),
		zoneConfig:   make(map[string]configEntry),
	}
}

func (r *RedisRegistry) Resolve(host string) (Config, bool) {
	host = normalizeHost(host)

	zoneID, found := r.resolveZoneID(host)
	if !found {
		return Config{}, false
	}
	return r.resolveConfig(zoneID)
}

// EvictZone drops a zone's cached config so the next request re-reads Redis
// — called by the configsync NATS subscriber (Task 8) on a
// config.zones.updated nudge.
func (r *RedisRegistry) EvictZone(zoneID string) {
	r.mu.Lock()
	delete(r.zoneConfig, zoneID)
	r.mu.Unlock()
}

func (r *RedisRegistry) resolveZoneID(host string) (string, bool) {
	r.mu.RLock()
	entry, ok := r.hostToZoneID[host]
	r.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.zoneID, entry.found
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	zoneID, err := r.client.Get(ctx, "zone_host:"+host).Result()
	found := err == nil
	if err != nil && !errors.Is(err, redis.Nil) {
		log.Printf("zone: zone_host lookup error for %q: %v", host, err)
	}

	r.mu.Lock()
	r.hostToZoneID[host] = hostEntry{zoneID: zoneID, found: found, expiresAt: time.Now().Add(r.ttl)}
	r.mu.Unlock()
	return zoneID, found
}

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash apps/edge-proxy/scripts/go-docker.sh go test -tags=integration ./internal/zone/...`
Expected: PASS.

- [ ] **Step 5: Run the existing unit tests to confirm `StaticRegistry` and its callers are untouched**

Run: `bash apps/edge-proxy/scripts/go-docker.sh go test ./...`
Expected: PASS — `zone_test.go` and every `proxy` package test still construct `zone.NewStaticRegistry` directly; `RedisRegistry` is additive.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-proxy/internal/zone
git commit -m "feat: Redis-backed zone.Registry with a 60s in-process config cache"
```

---

### Task 8: Edge Proxy — NATS subscriber + wire it all into `main.go`

**Files:**
- Create: `apps/edge-proxy/internal/configsync/subscriber.go`
- Test: `apps/edge-proxy/internal/configsync/subscriber_integration_test.go`
- Modify: `apps/edge-proxy/cmd/edge-proxy/main.go` (replace the Stage 3 `StaticRegistry` demo zone with `RedisRegistry` + `configsync.Subscribe`)
- Modify: `apps/edge-proxy/scripts/go-docker.sh` (forward `NATS_URL` into the container, same host-rewrite treatment as `REDIS_URL`)
- Modify: `apps/edge-proxy/go.mod`, `go.sum` (add `github.com/nats-io/nats.go`)

**Interfaces:**
- Consumes: `zone.RedisRegistry.EvictZone` (Task 7); `config.zones.updated` NATS subject (Task 6).
- Produces: `configsync.Subscribe(natsURL string, registry ZoneEvicter)` — best-effort, never fatal on a NATS outage; an edge-proxy binary that resolves every zone from Redis, with no more Stage 3 hardcoded demo zone.

- [ ] **Step 1: Add the NATS Go client dependency**

Run: `bash apps/edge-proxy/scripts/go-docker.sh go get github.com/nats-io/nats.go@latest`
Expected: `apps/edge-proxy/go.mod` gains a `github.com/nats-io/nats.go` requirement and `go.sum` is updated.

- [ ] **Step 2: Write the failing test — `apps/edge-proxy/internal/configsync/subscriber_integration_test.go`**

```go
//go:build integration

package configsync

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

type fakeEvicter struct {
	evicted chan string
}

func (f *fakeEvicter) EvictZone(zoneID string) {
	f.evicted <- zoneID
}

func natsURL() string {
	if u := os.Getenv("NATS_URL"); u != "" {
		return u
	}
	return "nats://localhost:4222"
}

func TestSubscribe_EvictsOnConfigZonesUpdated(t *testing.T) {
	evicter := &fakeEvicter{evicted: make(chan string, 1)}
	Subscribe(natsURL(), evicter)

	nc, err := nats.Connect(natsURL())
	if err != nil {
		t.Fatalf("failed to connect a publisher: %v", err)
	}
	defer nc.Close()

	payload, _ := json.Marshal(map[string]string{"zoneId": "zone-42"})
	if err := nc.Publish("config.zones.updated", payload); err != nil {
		t.Fatalf("publish failed: %v", err)
	}

	select {
	case zoneID := <-evicter.evicted:
		if zoneID != "zone-42" {
			t.Fatalf("expected zone-42, got %s", zoneID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the subscriber to evict zone-42")
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bash apps/edge-proxy/scripts/go-docker.sh go test -tags=integration ./internal/configsync/...`
Expected: FAIL to compile — package `configsync` does not exist.

- [ ] **Step 4: Implement `apps/edge-proxy/internal/configsync/subscriber.go`**

```go
package configsync

import (
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
)

// ZoneEvicter is satisfied by *zone.RedisRegistry — kept as a narrow
// interface here so this package doesn't need to import zone just to call
// one method.
type ZoneEvicter interface {
	EvictZone(zoneID string)
}

type configUpdate struct {
	ZoneID string `json:"zoneId"`
}

// Subscribe listens for the CDN Service's config.zones.updated notifications
// (docs/concepts/cdn-zones-and-configuration.md Section 4) and evicts that
// zone from the registry's in-process cache so the next request re-reads
// Redis instead of waiting out the up-to-60s TTL. Best-effort: a NATS outage
// only logs, since the 60s TTL is already the guaranteed fallback.
func Subscribe(natsURL string, registry ZoneEvicter) {
	nc, err := nats.Connect(natsURL)
	if err != nil {
		log.Printf("configsync: NATS unavailable, relying on the 60s config TTL: %v", err)
		return
	}
	if _, err := nc.Subscribe("config.zones.updated", func(msg *nats.Msg) {
		var update configUpdate
		if err := json.Unmarshal(msg.Data, &update); err != nil {
			log.Printf("configsync: bad config.zones.updated payload: %v", err)
			return
		}
		registry.EvictZone(update.ZoneID)
	}); err != nil {
		log.Printf("configsync: subscribe failed, relying on the 60s config TTL: %v", err)
	}
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash apps/edge-proxy/scripts/go-docker.sh go test -tags=integration ./internal/configsync/...`
Expected: PASS.

- [ ] **Step 6: Replace the Stage 3 demo zone with the Redis registry in `apps/edge-proxy/cmd/edge-proxy/main.go`**

Full replacement file:

```go
package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/configsync"
	"rivocloud/edge-proxy/internal/health"
	"rivocloud/edge-proxy/internal/proxy"
	"rivocloud/edge-proxy/internal/zone"
)

func main() {
	port := os.Getenv("EDGE_PROXY_PORT")
	if port == "" {
		port = "8888"
	}

	redisClient := mustConnectRedis()
	memory, err := cachestore.NewMemory(l1MaxEntries())
	if err != nil {
		log.Fatalf("failed to create L1 cache: %v", err)
	}

	zones := zone.NewRedisRegistry(redisClient)
	configsync.Subscribe(natsURL(), zones)

	handler := &proxy.CachingHandler{
		Zones: zones,
		Layers: []cachestore.Layer{
			memory,
			cachestore.NewRedis(redisClient, "edge-proxy:"),
		},
		Origin: newOriginClient(),
	}

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.NewHandler())
	mux.Handle("/", handler)

	log.Printf("edge-proxy listening on :%s (zone config read from Redis, published by the CDN Service)", port)
	if err := newServer(port, mux).ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// newOriginClient is the edge's own origin-fetch client. http.DefaultClient
// has no timeout at all, so a hung origin would pin the request goroutine and
// its connection indefinitely.
func newOriginClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}

// newServer applies listener-side deadlines. http.ListenAndServe's implicit
// server has none, leaving the proxy open to slow-loris clients and to
// connections that never make progress.
func newServer(port string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

func natsURL() string {
	if u := os.Getenv("NATS_URL"); u != "" {
		return u
	}
	return "nats://localhost:4222"
}

func l1MaxEntries() int {
	if raw := os.Getenv("EDGE_PROXY_L1_MAX_ENTRIES"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return n
		}
	}
	return 10_000
}

func mustConnectRedis() *redis.Client {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		log.Fatalf("invalid REDIS_URL %q: %v", url, err)
	}
	return redis.NewClient(opts)
}
```

This drops `demoOriginURL()` and the `EDGE_PROXY_DEMO_ORIGIN_URL` env var entirely — nothing references them once the hardcoded demo zone is gone, and `main_test.go`'s two tests (`newOriginClient`, `newServer`) don't touch either, so they need no change.

- [ ] **Step 7: Forward `NATS_URL` in `apps/edge-proxy/scripts/go-docker.sh`**

Full replacement file:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ -n "${CI:-}" ]; then
  # GitHub Actions runners have a native Go toolchain (actions/setup-go) —
  # skip Docker entirely there. The Docker wrapper below only exists to work
  # around this dev machine having no native Go toolchain.
  exec "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
WIN_REPO_ROOT="$(cygpath -w "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")"

# Containers can't reach the host (Redis, NATS) via "localhost" — Docker
# Desktop exposes the host as host.docker.internal instead. Local-dev-only
# workaround for this machine having no native Go toolchain; CI runs Go
# natively via actions/setup-go, where localhost is correct as-is.
rewrite_localhost() {
  local value="${1:-}"
  value="${value/127.0.0.1/host.docker.internal}"
  value="${value/localhost/host.docker.internal}"
  echo "$value"
}

CONTAINER_REDIS_URL="$(rewrite_localhost "${REDIS_URL:-redis://localhost:6379}")"
CONTAINER_NATS_URL="$(rewrite_localhost "${NATS_URL:-nats://localhost:4222}")"
CONTAINER_PORT="${EDGE_PROXY_PORT:-8888}"

DOCKER_ARGS=(
  --rm
  -v "${WIN_REPO_ROOT}://workspace"
  -w "//workspace/apps/edge-proxy"
  -e CGO_ENABLED=0
  -e GOFLAGS=-mod=mod
  -e REDIS_URL="${CONTAINER_REDIS_URL}"
  -e NATS_URL="${CONTAINER_NATS_URL}"
  -e EDGE_PROXY_PORT="${CONTAINER_PORT}"
  -e EDGE_PROXY_L1_MAX_ENTRIES="${EDGE_PROXY_L1_MAX_ENTRIES:-}"
)

# Only `go run` binds a port something outside the container needs to reach
# (manual verification, Task 9) — publish it only then. Publishing
# unconditionally would make concurrent `lint`/`typecheck`/`test:unit`
# invocations (turbo may run a package's own tasks concurrently — none of
# them declare a dependsOn ordering against each other) race for the same
# host port and fail with "address already in use".
if [ "${1:-}" = "go" ] && [ "${2:-}" = "run" ]; then
  DOCKER_ARGS+=(-p "${CONTAINER_PORT}:${CONTAINER_PORT}")
fi

docker run "${DOCKER_ARGS[@]}" golang:1.23-alpine "$@"
```

(Note `EDGE_PROXY_DEMO_ORIGIN_URL` is dropped here too, matching Step 6.)

- [ ] **Step 8: Run the full local suite**

```bash
pnpm turbo lint typecheck test:unit --filter=@rivocloud/edge-proxy
REDIS_URL=redis://localhost:6379 NATS_URL=nats://localhost:4222 pnpm turbo test:integration --filter=@rivocloud/edge-proxy
```
Expected: all PASS (needs `docker compose -f infrastructure/compose/docker-compose.infra.yml up -d redis nats` running first).

- [ ] **Step 9: Commit**

```bash
git add apps/edge-proxy
git commit -m "feat: read zone config from Redis and evict on NATS config.zones.updated (Stage 4.2)"
```

---

### Task 9: PRD update and manual end-to-end verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: a PRD marked with Stage 4 done, and a confirmed live walkthrough of the concept doc's Section 6 story — create a zone through the API, watch it start serving cached traffic through the already-running Edge Proxy with no restart.

No CI changes are needed here: `apps/cdn-service` is picked up automatically by `pnpm turbo lint typecheck test:unit test:integration` (workspace glob `apps/*` in `pnpm-workspace.yaml`) and `.github/workflows/ci.yml`'s `test-integration` job already exports `DATABASE_URL`, `REDIS_URL`, `NATS_URL`, and `INTERNAL_API_SECRET` as job-level env — the exact set `apps/cdn-service`'s env schema needs (`IDENTITY_SERVICE_URL` and `CDN_ROOT_DOMAIN` both have working defaults, and no test in this plan depends on a real running identity-service).

- [ ] **Step 1: Update the PRD to mark Stage 4 done**

In `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`, change the roadmap table row:
```
| 4 | CDN Service — zone CRUD, config publish to Redis | 2 | Not started | 2, 3 | [`cdn-zones-and-configuration.md`](../../concepts/cdn-zones-and-configuration.md) |
```
to:
```
| 4 | CDN Service — zone CRUD, config publish to Redis | 2 | ✅ Done | 2, 3 | [`cdn-zones-and-configuration.md`](../../concepts/cdn-zones-and-configuration.md) |
```

And change the **Status** line at the top of the document:
```
**Status:** Draft — Stages 1-3 (Infrastructure Foundation, Identity Service, Go Edge Proxy) complete, Stages 4–16 not started.
```
to:
```
**Status:** Draft — Stages 1-4 (Infrastructure Foundation, Identity Service, Go Edge Proxy, CDN Service) complete, Stages 5–16 not started.
```

- [ ] **Step 2: Manual end-to-end verification — the concept doc's walkthrough, for real**

Start infra and both services:
```bash
docker compose -f infrastructure/compose/docker-compose.infra.yml up -d postgres redis nats
pnpm --filter @rivocloud/db exec prisma migrate deploy
node apps/identity-service/scripts/generate-jwt-keys.cjs
INTERNAL_API_SECRET=dev_internal_secret pnpm --filter @rivocloud/identity-service dev &
INTERNAL_API_SECRET=dev_internal_secret pnpm --filter @rivocloud/cdn-service dev &
python -m http.server 9999 --directory . &
sleep 2
```

Register a user, create an org, and capture the access token:
```bash
curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"e2e@example.com","password":"hunter22222","name":"E2E"}' >/dev/null

LOGIN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"e2e@example.com","password":"hunter22222"}')
ACCESS_TOKEN=$(echo "$LOGIN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

ORG=$(curl -s -X POST http://localhost:3001/api/v1/orgs \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Org"}')
ORG_ACCESS_TOKEN=$(echo "$ORG" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
```

Create a zone pointing at the local static server:
```bash
ZONE=$(curl -s -X POST http://localhost:3003/api/v1/zones \
  -H "Authorization: Bearer $ORG_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Zone","originUrl":"http://localhost:9999"}')
echo "$ZONE"
ZONE_ID=$(echo "$ZONE" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
```
Expected: `ZONE` has `"slug":"e2e-zone"`, no `signingSecret` field.

Confirm the Redis keys landed:
```bash
docker compose -f infrastructure/compose/docker-compose.infra.yml exec redis redis-cli GET "zone_config:$ZONE_ID"
docker compose -f infrastructure/compose/docker-compose.infra.yml exec redis redis-cli GET "zone_host:e2e-zone.cdn.rivocloud.dev"
```
Expected: the first prints the zone's JSON config; the second prints `$ZONE_ID`.

Start the Edge Proxy and hit it with the zone's host:
```bash
(cd apps/edge-proxy && bash scripts/go-docker.sh go run ./cmd/edge-proxy) &
sleep 2

curl -s -D - -H "Host: e2e-zone.cdn.rivocloud.dev" http://localhost:8888/README.md -o /dev/null | grep -i "X-RivoCloud-Cache"
curl -s -D - -H "Host: e2e-zone.cdn.rivocloud.dev" http://localhost:8888/README.md -o /dev/null | grep -i "X-RivoCloud-Cache"
```
Expected: `MISS` then `HIT` — a zone created purely through the API is now serving cached traffic, with the Edge Proxy never restarted (PRD Section 5.2: "Zone configuration changes propagate to the edge proxy without a restart").

Finally, confirm a config change propagates without restarting the Edge Proxy:
```bash
curl -s -X PATCH "http://localhost:3003/api/v1/zones/$ZONE_ID" \
  -H "Authorization: Bearer $ORG_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' >/dev/null
sleep 1

curl -s -o /dev/null -w '%{http_code}\n' -H "Host: e2e-zone.cdn.rivocloud.dev" http://localhost:8888/README.md
```
Expected: `404` — the NATS `config.zones.updated` nudge evicted the zone from the Edge Proxy's in-process cache within about a second, well under the 60s TTL fallback, and a disabled zone resolves as not-found (Task 7, Step 3).

Stop the background processes afterward (`kill %1 %2 %3 %4` or close the terminal).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md
git commit -m "docs: mark Stage 4 (CDN Service) done in the PRD"
```
