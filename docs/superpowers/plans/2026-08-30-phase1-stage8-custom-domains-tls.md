# Phase 1 — Stage 8: Custom Domains + TLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer attach their own domain (e.g. `cdn.their-company.com`) to an existing zone, with DNS ownership verified and an HTTPS certificate issued and renewed automatically — matching the PRD's Stage 8 roadmap row exactly: "Custom Domains + TLS — Traefik Redis provider, DNS verification."

**Architecture:** The CDN Service gains a `domains` module (`POST/GET /zones/:zoneId/domains`, `DELETE .../domains/:d`, `POST .../domains/:d/verify`) that inserts a `zone_domains` row (`ssl_status: 'pending_dns'`) and writes the domain's routing rule into Traefik's Redis provider key space, exactly as the EDD's Section 5.8 walkthrough describes — Traefik is "ready" to route the hostname immediately, but no traffic reaches it until DNS actually points here. A new **Scheduler** microservice (NestJS, `apps/scheduler`, per EDD Section 2.8) owns the recurring verification work: every 30 seconds it re-checks every non-terminal domain, first confirming DNS resolves to RivoCloud's edge hostname (`pending_dns` → `pending_ssl`, and only then writes the `zone_host:{domain}` Redis key the Edge Proxy already resolves generically), then confirming a real TLS certificate is installed by making an actual TLS handshake against the domain (`pending_ssl` → `active`). The CDN Service's manual `.../verify` endpoint calls into the Scheduler's internal API to run that same check immediately instead of waiting for the next tick. A dashboard "Custom Domains" section on the existing zone detail page surfaces the CNAME instructions and live status, matching PRD Section 5.3's requirement that domain status be visible in the dashboard.

**Tech Stack:** NestJS 10 (`apps/scheduler` is a new service built the same way as `apps/cdn-service`), `@nestjs/schedule` (new dependency, Scheduler only), `@rivocloud/db` (Prisma — `ZoneDomain`/`JobRun` tables already exist since Stage 1, no migration needed), `ioredis`, Node's built-in `node:dns` and `node:tls` modules, Traefik v3 (new infrastructure component, Redis provider + ACME), Next.js 15 dashboard (existing patterns: TanStack Query hooks, zod validation, shadcn-style UI components).

**Spec:**
- [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.3 (Custom Domains + TLS), Section 7 (Roadmap, Stage 8)
- [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 2.8 (Scheduler), Section 5.8 (HTTPS and Custom Domains), Section 6 (`zone_domains`/`job_runs` schema), Section 7.5 (API), Section 11.8 (development order)
- [`docs/concepts/custom-domains-and-tls.md`](../../concepts/custom-domains-and-tls.md) — the beginner walkthrough this plan implements end-to-end

## Global Constraints

- API routes are versioned `/api/v1/...`.
- Every resource is org-scoped; a caller only ever sees domains belonging to zones owned by their own `orgId`.
- Domain CRUD reuses the existing `zone:read`/`zone:write`/`zone:delete` API-key scopes and the existing `ZoneScopeGuard` roles map (`read`/`write`/`delete` actions) — domains are a zone sub-resource with no distinct permission semantics, exactly like the Stage 7 `rules` module.
- Every backend microservice connects directly to the same shared Postgres via `@rivocloud/db`'s `prisma` singleton (the existing pattern in every service) — the new Scheduler service is no exception; it is not gated behind the CDN Service's HTTP API for its own database writes.
- Redis is the source of truth Traefik and the Edge Proxy read from; a missed NATS message (not used at all in this stage) or a delayed poll must never cause incorrect routing, only a delay before a domain becomes reachable.
- This dev machine has no native Go toolchain — not relevant to this stage (no Edge Proxy code changes are needed; it already resolves any `zone_host:{host}` key generically, custom or default).
- No new RBAC scope, no new NATS subjects, and no dashboard UI beyond the zone detail page's new "Custom Domains" section.

## Design Decisions (read before starting)

These resolve ambiguity the source docs leave open. Each is a deliberate, scoped choice — not a placeholder:

1. **The Scheduler service is scoped to DNS/TLS verification only.** EDD Section 2.8 lists five Scheduler responsibilities (lifecycle policies, cache warming, usage rollups, cert-expiry checks, stale zone cleanup); only "DNS verification polling" (EDD Section 11 block 8.3) belongs to this stage. The other four are out of scope until the stages that actually need them (Storage lifecycle, Analytics rollups) — this plan builds the Scheduler as a real, minimal NestJS service with room to grow, not a placeholder.
2. **Certificate-issuance is confirmed with a direct TLS handshake against the domain, not Traefik's API.** Traefik's REST API reports router *configuration* status (whether a route is parsed and active), not whether its ACME certificate has actually been issued — that state lives in `acme.json`, which Traefik deliberately does not expose over its API for security. The only way to observe the real, customer-facing outcome ("HTTPS now works for a real visitor," concept doc Section 7 step 8) is to open a TLS connection to the domain with the domain as SNI and inspect the certificate Traefik actually presents. `pending_ssl → active` uses this handshake; a non-matching or absent certificate (Traefik's own fallback cert, or a connection failure) means "not yet."
3. **The `zone_host:{domain}` Redis key — the thing that makes the Edge Proxy recognize the hostname at all — is written only once DNS is confirmed (`pending_dns → pending_ssl`), not at domain creation.** This matches the concept doc's Section 6.1 security rationale: RivoCloud must not start routing traffic for a domain before observing that its owner actually pointed DNS here. The Traefik router config, by contrast, is written immediately at creation (EDD Section 5.8 step 2 — "Traefik notices the new key and is now ready to route this hostname, but nothing has changed for real visitors yet").
4. **Timeouts for stuck domains:** the EDD specifies polling forever but not when to give up. This plan adds two configurable timeouts — `DOMAIN_DNS_TIMEOUT_MINUTES` (default 30) and `DOMAIN_SSL_TIMEOUT_MINUTES` (default 15) — after which a domain stuck in `pending_dns`/`pending_ssl` flips to `error` with a descriptive `sslError`, satisfying the EDD's four-state model (`pending_dns`/`pending_ssl`/`active`/`error`) instead of polling silently forever.
5. **Manually re-verifying an `error` domain resumes from whichever phase it last succeeded at**, rather than restarting from scratch: if `verifiedAt` is already set (DNS had resolved before the SSL phase timed out), a retry re-checks the certificate directly instead of re-checking DNS. The cron sweep itself never touches `error` domains automatically — only the manual "Verify" action retries them, so a domain that will never resolve doesn't get checked forever.
6. **No new shared package** between `apps/cdn-service` and the new `apps/scheduler`: the CDN Service calls the Scheduler's internal HTTP endpoint (`POST /internal/domains/:id/verify-now`, guarded by the same `INTERNAL_API_SECRET` header already used between the CDN Service and Identity Service) exactly the way `IdentityClient` already calls the Identity Service — not a shared TypeScript function, since these are two separate deployables.
7. **Traefik is added to `docker-compose.infra.yml` with full ACME wiring**, not a stub. Locally, without a public domain pointing at this machine, certificate issuance will simply never complete — an accepted, expected tradeoff (the same one already accepted for e.g. the `*.cdn.rivocloud.dev` wildcard certificate, which also can't be tested end-to-end without a real DNS zone), not a bug to work around.

## File Structure

```
infrastructure/compose/docker-compose.infra.yml   # modified: + traefik service
.env.example                                       # modified: + Traefik/Scheduler/domain env vars

apps/cdn-service/src/
  env.ts                                           # modified: + EDGE_PROXY_URL, EDGE_HOSTNAME, SCHEDULER_SERVICE_URL
  app.module.ts                                    # modified: + DomainsModule
  domains/
    dto/create-domain.dto.ts
    domain-response.util.ts
    traefik-config.publisher.ts
    traefik-config.publisher.integration.test.ts
    domains.service.ts
    domains.service.integration.test.ts
    scheduler-client.ts
    scheduler-client.test.ts
    scheduler-client.provider.ts
    domains.controller.ts
    domains.controller.integration.test.ts
    domains.module.ts

apps/scheduler/                                    # new NestJS service
  package.json, tsconfig.json, .swcrc, vitest.config.ts, vitest.integration.config.ts
  src/
    main.ts, app.module.ts, app-env.token.ts, env.ts, env.module.ts
    prisma/prisma.module.ts
    redis/redis.module.ts
    health/health.controller.ts, health.controller.integration.test.ts
    domains/
      dns-check.ts, dns-check.test.ts
      tls-check.ts, tls-check.test.ts
      domain-verification.service.ts, domain-verification.service.integration.test.ts
      domain-verification.cron.ts, domain-verification.cron.test.ts
      internal-auth.guard.ts, internal-auth.guard.test.ts
      domains-internal.controller.ts, domains-internal.controller.integration.test.ts
      domains.module.ts

apps/dashboard/src/
  lib/types.ts                                     # modified: + ZoneDomain
  lib/validation.ts                                # modified: + createDomainSchema
  app/api/zones/[zoneId]/domains/route.ts           # new
  app/api/zones/[zoneId]/domains/[domainId]/route.ts        # new
  app/api/zones/[zoneId]/domains/[domainId]/verify/route.ts # new
  hooks/use-domains.ts, use-create-domain.ts, use-delete-domain.ts, use-verify-domain.ts
  components/zones/zone-domains.tsx, zone-domains.test.tsx
  components/zones/zone-detail.tsx                 # modified: render <ZoneDomains>
  components/zones/zone-detail.test.tsx            # modified: default fetch stub for <ZoneDomains>

docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md   # modified: mark Stage 8 done
docs/concepts/custom-domains-and-tls.md                     # modified: remove "not built yet" caveat
```

---

### Task 1: Scaffold the Scheduler service (health check only)

**Files:**
- Create: `apps/scheduler/package.json`, `apps/scheduler/tsconfig.json`, `apps/scheduler/.swcrc`, `apps/scheduler/vitest.config.ts`, `apps/scheduler/vitest.integration.config.ts`
- Create: `apps/scheduler/src/main.ts`, `apps/scheduler/src/app.module.ts`, `apps/scheduler/src/app-env.token.ts`, `apps/scheduler/src/env.ts`, `apps/scheduler/src/env.module.ts`
- Create: `apps/scheduler/src/prisma/prisma.module.ts`, `apps/scheduler/src/redis/redis.module.ts`
- Create: `apps/scheduler/src/health/health.controller.ts`
- Test: `apps/scheduler/src/health/health.controller.integration.test.ts`
- Modify: `turbo.json`, `.github/workflows/ci.yml`, `.env.example`

**Interfaces:**
- Consumes: `@rivocloud/config`'s `baseEnvSchema`/`validateEnv` (already used by every other service), `@rivocloud/db`'s `prisma` singleton.
- Produces: a bootable NestJS service on `env.PORT` (default 3005) with `GET /api/v1/health → { status: 'ok' }`; `APP_ENV` DI token; `PRISMA`/`REDIS` DI tokens — all consumed by every later Scheduler task.

- [ ] **Step 1: Create the package scaffold**

`apps/scheduler/package.json`:

```json
{
  "name": "@rivocloud/scheduler",
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
    "@nestjs/schedule": "^4.1.1",
    "@rivocloud/config": "workspace:*",
    "@rivocloud/db": "workspace:*",
    "ioredis": "^5.4.1",
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

`apps/scheduler/tsconfig.json`:

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

`apps/scheduler/.swcrc`:

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

`apps/scheduler/vitest.config.ts`:

```ts
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

`apps/scheduler/vitest.integration.config.ts`:

```ts
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

- [ ] **Step 2: Add env, DI tokens, and modules**

`apps/scheduler/src/app-env.token.ts`:

```ts
export const APP_ENV = 'APP_ENV';
```

`apps/scheduler/src/env.ts`:

```ts
import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@rivocloud/config';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3005),
  INTERNAL_API_SECRET: z.string().min(16),
  EDGE_HOSTNAME: z.string().min(1).toLowerCase().default('edge.rivocloud.dev'),
  DOMAIN_DNS_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  DOMAIN_SSL_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return validateEnv(envSchema, env);
}
```

`apps/scheduler/src/env.module.ts`:

```ts
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

`apps/scheduler/src/prisma/prisma.module.ts`:

```ts
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

`apps/scheduler/src/redis/redis.module.ts`:

```ts
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

`apps/scheduler/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('api/v1/health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

`apps/scheduler/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule],
  controllers: [HealthController],
})
export class AppModule {}
```

`apps/scheduler/src/main.ts`:

```ts
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
  console.log(`scheduler listening on :${env.PORT}`);
}

bootstrap();
```

- [ ] **Step 3: Write the failing health-check integration test**

Create `apps/scheduler/src/health/health.controller.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module.js';

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Install dependencies and run the test to verify it fails, then passes**

Run: `pnpm install` (registers the new workspace package), then `pnpm --filter @rivocloud/scheduler test:integration`
Expected first: FAIL (module doesn't exist / `INTERNAL_API_SECRET` not set). Set a throwaway `INTERNAL_API_SECRET` env var for the run if your shell doesn't already export one from the other services' testing, then re-run.
Expected after implementing Steps 1–2: PASS.

- [ ] **Step 5: Wire the new service into `turbo.json` and CI**

In `turbo.json`, add the two new env vars this service's integration tests need to the existing `test:integration` task's `env` array (it already lists `INTERNAL_API_SECRET`, `DATABASE_URL`, `REDIS_URL`, `NATS_URL` — no new entries needed there; only add the Scheduler-specific ones):

```json
    "test:integration": {
      "outputs": [],
      "env": ["DATABASE_URL", "REDIS_URL", "NATS_URL", "JWT_PRIVATE_KEY_PATH", "JWT_PUBLIC_KEY_PATH", "INTERNAL_API_SECRET", "MINIO_URL", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD", "MINIO_WEBHOOK_AUTH_TOKEN", "EDGE_HOSTNAME", "SCHEDULER_SERVICE_URL"]
    },
```

`.github/workflows/ci.yml` already runs `pnpm turbo test:unit`/`test:integration` across every workspace package with no per-service listing, so no CI changes are needed beyond this — `pnpm turbo` picks up `apps/scheduler` automatically via `pnpm-workspace.yaml`'s `apps/*` glob.

Add to root `.env.example`, after the `# CDN Service` section:

```
# Scheduler
SCHEDULER_SERVICE_PORT=3005
SCHEDULER_SERVICE_URL=http://localhost:3005
EDGE_HOSTNAME=edge.rivocloud.dev
DOMAIN_DNS_TIMEOUT_MINUTES=30
DOMAIN_SSL_TIMEOUT_MINUTES=15
```

- [ ] **Step 6: Commit**

```bash
git add apps/scheduler turbo.json .env.example
git commit -m "feat(scheduler): scaffold NestJS service with health check"
```

---

### Task 2: Add Traefik to local infrastructure

**Files:**
- Modify: `infrastructure/compose/docker-compose.infra.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: the `redis` service already defined in the compose file.
- Produces: a running Traefik container reading routing config from `traefik/http/...` Redis keys (Task 3 writes these), listening on `:80`/`:443` for real traffic and `:8080` for its API/dashboard.

- [ ] **Step 1: Add the `traefik` service**

In `infrastructure/compose/docker-compose.infra.yml`, add a new service (after `redis`, since it depends on it) and a new named volume:

```yaml
  traefik:
    image: traefik:v3.1
    command:
      - "--providers.redis.endpoints=redis:6379"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=${TRAEFIK_ACME_EMAIL:-admin@rivocloud.dev}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--api.insecure=true"
      - "--api.dashboard=true"
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - traefik_certs:/letsencrypt
    depends_on:
      redis:
        condition: service_healthy
    networks: [rivocloud]
```

And add `traefik_certs:` to the top-level `volumes:` block (alongside `postgres_data`, `redis_data`, etc.):

```yaml
volumes:
  postgres_data:
  redis_data:
  minio_data:
  clickhouse_data:
  traefik_certs:
```

- [ ] **Step 2: Add the ACME email env var**

In `.env.example`, add a line near the top-level infra section (after the `# Redis` block):

```
# Traefik
TRAEFIK_ACME_EMAIL=admin@rivocloud.dev
```

- [ ] **Step 3: Validate the compose file**

Run: `docker compose -f infrastructure/compose/docker-compose.infra.yml config`
Expected: prints the fully-resolved YAML with no errors (this is infra-as-code; there's no application test to run, so validating the compose file parses and resolves is the equivalent "make it pass" step).

If Docker isn't available in this environment, at minimum confirm the YAML is syntactically valid: `python -c "import yaml, sys; yaml.safe_load(open('infrastructure/compose/docker-compose.infra.yml'))"` or an equivalent YAML linter.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/compose/docker-compose.infra.yml .env.example
git commit -m "feat(infra): add Traefik with Redis provider and ACME resolver"
```

---

### Task 3: CDN Service — `TraefikConfigPublisher`

**Files:**
- Create: `apps/cdn-service/src/domains/traefik-config.publisher.ts`
- Test: `apps/cdn-service/src/domains/traefik-config.publisher.integration.test.ts`
- Modify: `apps/cdn-service/src/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `REDIS` DI token, `APP_ENV` DI token (both existing).
- Produces: `TraefikConfigPublisher.publish(domain: string): Promise<void>` and `.unpublish(domain: string): Promise<void>`, used by Task 4's `DomainsService`.

- [ ] **Step 1: Add the new env vars**

In `apps/cdn-service/src/env.ts`, extend the schema:

```ts
export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3003),
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_API_SECRET: z.string().min(16),
  CDN_ROOT_DOMAIN: z.string().min(1).toLowerCase().default('cdn.rivocloud.dev'),
  EDGE_PROXY_URL: z.string().url().default('http://host.docker.internal:8888'),
  EDGE_HOSTNAME: z.string().min(1).toLowerCase().default('edge.rivocloud.dev'),
  SCHEDULER_SERVICE_URL: z.string().url().default('http://localhost:3005'),
});
```

Add to `.env.example`, in the `# CDN Service` section:

```
EDGE_PROXY_URL=http://host.docker.internal:8888
EDGE_HOSTNAME=edge.rivocloud.dev
SCHEDULER_SERVICE_URL=http://localhost:3005
```

- [ ] **Step 2: Write the failing test**

Create `apps/cdn-service/src/domains/traefik-config.publisher.integration.test.ts`:

```ts
import { describe, expect, it, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { TraefikConfigPublisher } from './traefik-config.publisher.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const env = { EDGE_PROXY_URL: 'http://edge-proxy-test:8888' } as { EDGE_PROXY_URL: string };
const publisher = new TraefikConfigPublisher(redis, env as never);

describe('TraefikConfigPublisher', () => {
  afterAll(() => {
    redis.disconnect();
  });

  it('writes the router rule, service reference, entrypoint, and TLS resolver for a domain', async () => {
    const domain = `cdn.publisher-test-${Date.now()}.example.com`;
    await publisher.publish(domain);

    const router = `traefik/http/routers/${domain}`;
    expect(await redis.get(`${router}/rule`)).toBe(`Host(\`${domain}\`)`);
    expect(await redis.get(`${router}/service`)).toBe('edge-proxy');
    expect(await redis.get(`${router}/entryPoints/0`)).toBe('websecure');
    expect(await redis.get(`${router}/tls`)).toBe('true');
    expect(await redis.get(`${router}/tls/certResolver`)).toBe('letsencrypt');

    await publisher.unpublish(domain);
  });

  it('writes the shared edge-proxy service target from EDGE_PROXY_URL', async () => {
    const domain = `cdn.publisher-test-${Date.now()}-b.example.com`;
    await publisher.publish(domain);

    expect(await redis.get('traefik/http/services/edge-proxy/loadBalancer/servers/0/url')).toBe(
      'http://edge-proxy-test:8888',
    );

    await publisher.unpublish(domain);
  });

  it('unpublish removes every router key for that domain', async () => {
    const domain = `cdn.publisher-test-${Date.now()}-c.example.com`;
    await publisher.publish(domain);
    await publisher.unpublish(domain);

    const router = `traefik/http/routers/${domain}`;
    expect(await redis.get(`${router}/rule`)).toBeNull();
    expect(await redis.get(`${router}/service`)).toBeNull();
    expect(await redis.get(`${router}/entryPoints/0`)).toBeNull();
    expect(await redis.get(`${router}/tls`)).toBeNull();
    expect(await redis.get(`${router}/tls/certResolver`)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- traefik-config.publisher`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `TraefikConfigPublisher`**

Create `apps/cdn-service/src/domains/traefik-config.publisher.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

// Every custom domain's router points at this one shared Traefik "service"
// (its load-balancer backend), rather than each domain getting its own
// service block — the Edge Proxy is a single fleet, not one per domain
// (EDD Section 5.8: "Traefik picks up the change automatically ... No
// Traefik restart required").
const EDGE_SERVICE_NAME = 'edge-proxy';

@Injectable()
export class TraefikConfigPublisher {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async publish(domain: string): Promise<void> {
    // Idempotent: re-written on every domain publish so the shared service
    // target always reflects the current EDGE_PROXY_URL, with no separate
    // startup step required.
    await this.redis.set(
      `traefik/http/services/${EDGE_SERVICE_NAME}/loadBalancer/servers/0/url`,
      this.env.EDGE_PROXY_URL,
    );

    const router = `traefik/http/routers/${domain}`;
    await this.redis.mset({
      [`${router}/rule`]: `Host(\`${domain}\`)`,
      [`${router}/service`]: EDGE_SERVICE_NAME,
      [`${router}/entryPoints/0`]: 'websecure',
      [`${router}/tls`]: 'true',
      [`${router}/tls/certResolver`]: 'letsencrypt',
    });
  }

  async unpublish(domain: string): Promise<void> {
    const router = `traefik/http/routers/${domain}`;
    await this.redis.del(
      `${router}/rule`,
      `${router}/service`,
      `${router}/entryPoints/0`,
      `${router}/tls`,
      `${router}/tls/certResolver`,
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- traefik-config.publisher`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cdn-service/src/domains/traefik-config.publisher.ts apps/cdn-service/src/domains/traefik-config.publisher.integration.test.ts apps/cdn-service/src/env.ts .env.example
git commit -m "feat(cdn-service): add TraefikConfigPublisher for custom domain routing"
```

---

### Task 4: CDN Service — Domains DTO + `DomainsService`

**Files:**
- Create: `apps/cdn-service/src/domains/dto/create-domain.dto.ts`
- Create: `apps/cdn-service/src/domains/domain-response.util.ts`
- Create: `apps/cdn-service/src/domains/domains.service.ts`
- Test: `apps/cdn-service/src/domains/domains.service.integration.test.ts`

**Interfaces:**
- Consumes: `PRISMA`/`REDIS`/`APP_ENV` DI tokens, `TraefikConfigPublisher` (Task 3).
- Produces: `DomainsService.create/list/remove/findOwnedDomain`, used by Task 5's controller.

- [ ] **Step 1: Write the DTO**

Create `apps/cdn-service/src/domains/dto/create-domain.dto.ts`:

```ts
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// RFC 1123 hostname: two or more dot-separated labels, each 1-63
// alphanumerics/hyphens with no leading/trailing hyphen — matches what a
// customer's DNS provider would accept as a CNAME source, and rejects
// protocol prefixes, paths, ports, or wildcards a customer might paste in
// by mistake.
const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export class CreateDomainDto {
  @IsString()
  @MinLength(1)
  @MaxLength(253)
  @Matches(HOSTNAME_PATTERN, { message: 'domain must be a valid hostname, e.g. cdn.your-company.com' })
  domain!: string;
}
```

- [ ] **Step 2: Write the response util**

Create `apps/cdn-service/src/domains/domain-response.util.ts`:

```ts
import type { ZoneDomain } from '@rivocloud/db';

export interface DomainResponse extends ZoneDomain {
  cnameTarget: string;
}

export function toDomainResponse(domain: ZoneDomain, cnameTarget: string): DomainResponse {
  return { ...domain, cnameTarget };
}
```

- [ ] **Step 3: Write the failing `DomainsService` integration test**

Create `apps/cdn-service/src/domains/domains.service.integration.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TraefikConfigPublisher } from './traefik-config.publisher.js';
import { DomainsService } from './domains.service.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const env = { EDGE_PROXY_URL: 'http://edge-proxy-test:8888', EDGE_HOSTNAME: 'edge.rivocloud.dev' };
const publisher = new TraefikConfigPublisher(redis, env as never);
const service = new DomainsService(prisma, redis, env as never, publisher);

async function seedZone() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  const zone = await prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
  });
  return { org, zone };
}

describe('DomainsService', () => {
  beforeEach(async () => {
    await prisma.zoneDomain.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a domain scoped to the owning org, lowercased, with a CNAME target', async () => {
    const { org, zone } = await seedZone();
    const domain = await service.create(org.id, zone.id, { domain: `CDN.Example-${randomUUID()}.com` });
    expect(domain.domain).toBe(domain.domain.toLowerCase());
    expect(domain.sslStatus).toBe('pending_dns');
    expect(domain.cnameTarget).toBe('edge.rivocloud.dev');

    const router = `traefik/http/routers/${domain.domain}`;
    expect(await redis.get(`${router}/rule`)).toBe(`Host(\`${domain.domain}\`)`);
  });

  it('rejects creating a domain for a zone owned by a different org', async () => {
    const { zone } = await seedZone();
    await expect(service.create('someone-elses-org', zone.id, { domain: `cdn-${randomUUID()}.example.com` })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a domain that is already registered to any zone', async () => {
    const { org, zone } = await seedZone();
    const domain = `cdn-${randomUUID()}.example.com`;
    await service.create(org.id, zone.id, { domain });
    await expect(service.create(org.id, zone.id, { domain })).rejects.toThrow(ConflictException);
  });

  it('lists domains for a zone', async () => {
    const { org, zone } = await seedZone();
    await service.create(org.id, zone.id, { domain: `a-${randomUUID()}.example.com` });
    await service.create(org.id, zone.id, { domain: `b-${randomUUID()}.example.com` });
    const domains = await service.list(org.id, zone.id);
    expect(domains).toHaveLength(2);
  });

  it('removes a domain, unpublishes Traefik config, and clears any zone_host mapping', async () => {
    const { org, zone } = await seedZone();
    const created = await service.create(org.id, zone.id, { domain: `remove-me-${randomUUID()}.example.com` });
    await redis.set(`zone_host:${created.domain}`, zone.id);

    await service.remove(org.id, zone.id, created.id);

    expect(await prisma.zoneDomain.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await redis.get(`traefik/http/routers/${created.domain}/rule`)).toBeNull();
    expect(await redis.get(`zone_host:${created.domain}`)).toBeNull();
  });

  it('rejects removing a domain that does not belong to the given zone', async () => {
    const { org, zone } = await seedZone();
    const { zone: otherZone } = await seedZone();
    const created = await service.create(org.id, zone.id, { domain: `mismatch-${randomUUID()}.example.com` });
    await expect(service.remove(org.id, otherZone.id, created.id)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- domains.service`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Implement `DomainsService`**

Create `apps/cdn-service/src/domains/domains.service.ts`:

```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Prisma } from '@rivocloud/db';
import type { PrismaClient, PullZone, ZoneDomain } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { TraefikConfigPublisher } from './traefik-config.publisher.js';
import { toDomainResponse, type DomainResponse } from './domain-response.util.js';
import type { CreateDomainDto } from './dto/create-domain.dto.js';

@Injectable()
export class DomainsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly traefik: TraefikConfigPublisher,
  ) {}

  async create(orgId: string, zoneId: string, dto: CreateDomainDto): Promise<DomainResponse> {
    await this.findOwnedZone(orgId, zoneId);
    const domain = dto.domain.toLowerCase().replace(/\.$/, '');

    let created: ZoneDomain;
    try {
      created = await this.db.zoneDomain.create({ data: { zoneId, domain } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This domain is already in use');
      }
      throw error;
    }
    await this.traefik.publish(domain);
    return toDomainResponse(created, this.env.EDGE_HOSTNAME);
  }

  async list(orgId: string, zoneId: string): Promise<DomainResponse[]> {
    await this.findOwnedZone(orgId, zoneId);
    const domains = await this.db.zoneDomain.findMany({ where: { zoneId }, orderBy: { createdAt: 'asc' } });
    return domains.map((domain) => toDomainResponse(domain, this.env.EDGE_HOSTNAME));
  }

  async remove(orgId: string, zoneId: string, domainId: string): Promise<void> {
    const domain = await this.findOwnedDomain(orgId, zoneId, domainId);
    await this.traefik.unpublish(domain.domain);
    await this.redis.del(`zone_host:${domain.domain}`);
    await this.db.zoneDomain.delete({ where: { id: domainId } });
  }

  async findOwnedDomain(orgId: string, zoneId: string, domainId: string): Promise<ZoneDomain> {
    await this.findOwnedZone(orgId, zoneId);
    const domain = await this.db.zoneDomain.findUnique({ where: { id: domainId } });
    if (!domain || domain.zoneId !== zoneId) {
      throw new NotFoundException('Domain not found');
    }
    return domain;
  }

  private async findOwnedZone(orgId: string, zoneId: string): Promise<PullZone> {
    const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
    if (!zone || zone.orgId !== orgId) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- domains.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/cdn-service/src/domains/dto/create-domain.dto.ts apps/cdn-service/src/domains/domain-response.util.ts apps/cdn-service/src/domains/domains.service.ts apps/cdn-service/src/domains/domains.service.integration.test.ts
git commit -m "feat(cdn-service): add DomainsService for custom domain CRUD"
```

---

### Task 5: CDN Service — `SchedulerClient` + `DomainsController`

**Files:**
- Create: `apps/cdn-service/src/domains/scheduler-client.ts`
- Test: `apps/cdn-service/src/domains/scheduler-client.test.ts`
- Create: `apps/cdn-service/src/domains/scheduler-client.provider.ts`
- Create: `apps/cdn-service/src/domains/domains.controller.ts`
- Test: `apps/cdn-service/src/domains/domains.controller.integration.test.ts`
- Create: `apps/cdn-service/src/domains/domains.module.ts`
- Modify: `apps/cdn-service/src/app.module.ts`

**Interfaces:**
- Consumes: `DomainsService` (Task 4), `AuthGuard`/`ZoneScopeGuard`/`RequireZoneScope`/`AuthCtx`/`CombinedAuthContext` (existing, from `../auth/*`).
- Produces: `POST/GET /api/v1/zones/:zoneId/domains`, `DELETE /api/v1/zones/:zoneId/domains/:domainId`, `POST /api/v1/zones/:zoneId/domains/:domainId/verify`. `SchedulerClient.verifyDomainNow(domainId: string): Promise<VerifyDomainResult>` — the internal HTTP call Task 9's Scheduler endpoint receives.

- [ ] **Step 1: Write the failing `SchedulerClient` test**

Create `apps/cdn-service/src/domains/scheduler-client.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ServiceUnavailableException } from '@nestjs/common';
import { SchedulerClient } from './scheduler-client.js';

describe('SchedulerClient', () => {
  let server: Server;
  let baseUrl: string;
  let lastSecretHeader: string | undefined;
  let lastPath: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastSecretHeader = req.headers['x-internal-secret'] as string | undefined;
      lastPath = req.url;
      if (req.url === '/internal/domains/domain-1/verify-now') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'domain-1', sslStatus: 'pending_ssl', sslError: null }));
      } else {
        res.writeHead(404);
        res.end();
      }
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

  it('posts to the internal verify-now endpoint with the internal secret header', async () => {
    const client = new SchedulerClient(baseUrl, 'test-secret');
    const result = await client.verifyDomainNow('domain-1');
    expect(result).toEqual({ id: 'domain-1', sslStatus: 'pending_ssl', sslError: null });
    expect(lastSecretHeader).toBe('test-secret');
    expect(lastPath).toBe('/internal/domains/domain-1/verify-now');
  });

  it('throws ServiceUnavailableException for an unknown domain', async () => {
    const client = new SchedulerClient(baseUrl, 'test-secret');
    await expect(client.verifyDomainNow('missing')).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException when the Scheduler is unreachable', async () => {
    const client = new SchedulerClient('http://127.0.0.1:1', 'test-secret');
    await expect(client.verifyDomainNow('domain-1')).rejects.toThrow(ServiceUnavailableException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:unit -- scheduler-client`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `SchedulerClient`**

Create `apps/cdn-service/src/domains/scheduler-client.ts`:

```ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface VerifyDomainResult {
  id: string;
  sslStatus: string;
  sslError: string | null;
}

@Injectable()
export class SchedulerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async verifyDomainNow(domainId: string): Promise<VerifyDomainResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/domains/${domainId}/verify-now`, {
        method: 'POST',
        headers: { 'X-Internal-Secret': this.internalSecret },
      });
    } catch {
      throw new ServiceUnavailableException('Scheduler service unreachable');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('Domain verification failed');
    }
    return (await response.json()) as VerifyDomainResult;
  }
}
```

Create `apps/cdn-service/src/domains/scheduler-client.provider.ts`:

```ts
import { Provider } from '@nestjs/common';
import { SchedulerClient } from './scheduler-client.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const schedulerClientProvider: Provider = {
  provide: SchedulerClient,
  useFactory: (env: AppEnv) => new SchedulerClient(env.SCHEDULER_SERVICE_URL, env.INTERNAL_API_SECRET),
  inject: [APP_ENV],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:unit -- scheduler-client`
Expected: PASS.

- [ ] **Step 5: Write the failing `DomainsController` integration test**

Create `apps/cdn-service/src/domains/domains.controller.integration.test.ts` (mirrors `rules.controller.integration.test.ts`'s `FakeIdentityClient` harness, plus a fake `SchedulerClient` so this test never depends on Task 9's Scheduler endpoint existing):

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
import { SchedulerClient, type VerifyDomainResult } from './scheduler-client.js';

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

class FakeSchedulerClient {
  nextResult: VerifyDomainResult = { id: 'unused', sslStatus: 'pending_ssl', sslError: null };
  lastDomainId: string | null = null;
  async verifyDomainNow(domainId: string): Promise<VerifyDomainResult> {
    this.lastDomainId = domainId;
    return this.nextResult;
  }
}

describe('DomainsController', () => {
  let app: INestApplication;
  let fakeIdentity: FakeIdentityClient;
  let fakeScheduler: FakeSchedulerClient;

  beforeAll(async () => {
    fakeIdentity = new FakeIdentityClient();
    fakeScheduler = new FakeSchedulerClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityClient)
      .useValue(fakeIdentity)
      .overrideProvider(SchedulerClient)
      .useValue(fakeScheduler)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.zoneDomain.deleteMany();
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

  it('creates and lists a domain', async () => {
    const zone = await seedZoneAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: `cdn-${randomUUID()}.example.com` });
    expect(created.status).toBe(201);
    expect(created.body.sslStatus).toBe('pending_dns');
    expect(created.body.cnameTarget).toBeTruthy();

    const list = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('rejects an invalid hostname', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: 'not a hostname!' });
    expect(response.status).toBe(400);
  });

  it('rejects a viewer trying to add a domain', async () => {
    const zone = await seedZoneAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: `cdn-${randomUUID()}.example.com` });
    expect(response.status).toBe(403);
  });

  it('deletes a domain', async () => {
    const zone = await seedZoneAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: `cdn-${randomUUID()}.example.com` });

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/zones/${zone.id}/domains/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);
  });

  it('verify calls the Scheduler and returns its result', async () => {
    const zone = await seedZoneAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: `cdn-${randomUUID()}.example.com` });

    fakeScheduler.nextResult = { id: created.body.id, sslStatus: 'active', sslError: null };
    const verified = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains/${created.body.id}/verify`)
      .set('Authorization', 'Bearer whatever');
    expect(verified.status).toBe(201);
    expect(verified.body).toEqual({ id: created.body.id, sslStatus: 'active', sslError: null });
    expect(fakeScheduler.lastDomainId).toBe(created.body.id);
  });

  it('verify 404s for a domain that does not belong to the zone', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains/${randomUUID()}/verify`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- domains.controller`
Expected: FAIL — `AppModule` doesn't yet import a domains module, route 404s.

- [ ] **Step 7: Implement `DomainsController` and `DomainsModule`, wire into `AppModule`**

Create `apps/cdn-service/src/domains/domains.controller.ts`:

```ts
import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireZoneScope, ZoneScopeGuard } from '../auth/zone-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { DomainsService } from './domains.service.js';
import { SchedulerClient } from './scheduler-client.js';
import { CreateDomainDto } from './dto/create-domain.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/zones/:zoneId/domains')
@UseGuards(AuthGuard, ZoneScopeGuard)
export class DomainsController {
  constructor(
    private readonly domains: DomainsService,
    private readonly scheduler: SchedulerClient,
  ) {}

  @Post()
  @RequireZoneScope('write')
  create(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Body() dto: CreateDomainDto) {
    return this.domains.create(requireOrgId(auth), zoneId, dto);
  }

  @Get()
  @RequireZoneScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string) {
    return this.domains.list(requireOrgId(auth), zoneId);
  }

  @Delete(':domainId')
  @RequireZoneScope('delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('zoneId') zoneId: string, @Param('domainId') domainId: string) {
    await this.domains.remove(requireOrgId(auth), zoneId, domainId);
    return { success: true };
  }

  @Post(':domainId/verify')
  @RequireZoneScope('write')
  async verify(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('zoneId') zoneId: string,
    @Param('domainId') domainId: string,
  ) {
    await this.domains.findOwnedDomain(requireOrgId(auth), zoneId, domainId);
    return this.scheduler.verifyDomainNow(domainId);
  }
}
```

Create `apps/cdn-service/src/domains/domains.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller.js';
import { DomainsService } from './domains.service.js';
import { TraefikConfigPublisher } from './traefik-config.publisher.js';
import { schedulerClientProvider } from './scheduler-client.provider.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [DomainsController],
  providers: [DomainsService, TraefikConfigPublisher, schedulerClientProvider],
})
export class DomainsModule {}
```

In `apps/cdn-service/src/app.module.ts`, add the import and module:

```ts
import { DomainsModule } from './domains/domains.module.js';
```

```ts
  imports: [EnvModule, PrismaModule, RedisModule, EventsModule, ZonesModule, RulesModule, InvalidationsModule, DomainsModule],
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/cdn-service test:integration -- domains.controller`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/cdn-service/src/domains apps/cdn-service/src/app.module.ts
git commit -m "feat(cdn-service): add domains REST API with Scheduler-backed verification"
```

---

### Task 6: Scheduler — DNS and TLS verification primitives

**Files:**
- Create: `apps/scheduler/src/domains/dns-check.ts`
- Test: `apps/scheduler/src/domains/dns-check.test.ts`
- Create: `apps/scheduler/src/domains/tls-check.ts`
- Test: `apps/scheduler/src/domains/tls-check.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolvesToEdge(domain: string, edgeHostname: string, resolver?: DnsResolver): Promise<boolean>` and `checkTlsCertificate(domain: string, opts?: CheckTlsCertificateOptions): Promise<TlsCertificateResult>`, both consumed by Task 7's `DomainVerificationService`.

- [ ] **Step 1: Write the failing DNS-check tests**

Create `apps/scheduler/src/domains/dns-check.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolvesToEdge, type DnsResolver } from './dns-check.js';

function fakeResolver(overrides: Partial<DnsResolver>): DnsResolver {
  return {
    resolveCname: async () => {
      throw new Error('no CNAME');
    },
    resolve4: async () => {
      throw new Error('no A record');
    },
    ...overrides,
  };
}

describe('resolvesToEdge', () => {
  it('returns true when the domain has a CNAME pointing at the edge hostname', async () => {
    const resolver = fakeResolver({ resolveCname: async () => ['edge.rivocloud.dev.'] });
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(true);
  });

  it('is case-insensitive and ignores a trailing dot', async () => {
    const resolver = fakeResolver({ resolveCname: async () => ['EDGE.RivoCloud.dev'] });
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(true);
  });

  it('returns false when the CNAME points elsewhere and no A record matches', async () => {
    const resolver = fakeResolver({
      resolveCname: async () => ['someone-else.example.net'],
      resolve4: async (host: string) => (host === 'edge.rivocloud.dev' ? ['1.2.3.4'] : ['9.9.9.9']),
    });
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(false);
  });

  it('falls back to comparing A records when there is no CNAME (apex domain)', async () => {
    const resolver = fakeResolver({
      resolve4: async (host: string) => (host === 'cdn.example.com' ? ['1.2.3.4'] : ['1.2.3.4']),
    });
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(true);
  });

  it('returns false when neither CNAME nor A record resolution succeeds', async () => {
    const resolver = fakeResolver({});
    expect(await resolvesToEdge('cdn.example.com', 'edge.rivocloud.dev', resolver)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/scheduler test:unit -- dns-check`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `dns-check.ts`**

Create `apps/scheduler/src/domains/dns-check.ts`:

```ts
import { promises as dns } from 'node:dns';

export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

// Confirms a customer's domain points at RivoCloud before treating it as
// legitimate (concept doc Section 6.1). Tries CNAME first (the record the
// dashboard instructs customers to add); falls back to comparing A records
// so an apex domain — which can't have a CNAME — still verifies correctly
// if the customer used an ALIAS/ANAME record or a manual A record instead.
export async function resolvesToEdge(
  domain: string,
  edgeHostname: string,
  resolver: DnsResolver = dns,
): Promise<boolean> {
  try {
    const cnames = await resolver.resolveCname(domain);
    if (cnames.some((cname) => normalizeHost(cname) === normalizeHost(edgeHostname))) {
      return true;
    }
  } catch {
    // No CNAME record — fall through to comparing A records.
  }
  try {
    const [domainIps, edgeIps] = await Promise.all([resolver.resolve4(domain), resolver.resolve4(edgeHostname)]);
    return domainIps.some((ip) => edgeIps.includes(ip));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/scheduler test:unit -- dns-check`
Expected: PASS.

- [ ] **Step 5: Write the failing TLS-check tests**

Create `apps/scheduler/src/domains/tls-check.test.ts`. This uses two pre-generated self-signed certificate/key pairs — one for `cdn.example.com` (the "matching" cert) and one for `other.example.com` (representing Traefik's own default/fallback cert, standing in for "not this domain's cert yet") — served from a local `tls.Server` with an SNI callback, so the test never touches a real network domain:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as tls from 'node:tls';
import { checkTlsCertificate } from './tls-check.js';

const MATCH_CERT = `-----BEGIN CERTIFICATE-----
MIIDMTCCAhmgAwIBAgIUM8SXiBgTsQZAu9YRc8AtO3o7d5wwDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPY2RuLmV4YW1wbGUuY29tMB4XDTI2MDgzMDA5MzA1MFoX
DTM2MDgyNzA5MzA1MFowGjEYMBYGA1UEAwwPY2RuLmV4YW1wbGUuY29tMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsdAEXPR1pZ34SbRWJ0Zlh2miJB0/
pwW7ySAs7p8tPhspdfj3Ddzm1/TFspE3z8zppVOFVlNqqDdT3YQT2XHgWABhb9mW
Gr0VuVrhJ3lEeDRt8NWyn8M76I/16QtTVLa35elY8ErnHQOKGIEYJh8yrpjhXOEi
I4Jw8vQJCoCBiTNFMcJ+AUfpqG4ezqaeQs62YudxTgqw3oBQ/Stnta6vBfRD2dBc
eUjkljlpBMSJ+KnCjTwcbqns43LwyUgBQ1GKCNmw3r+5PksNmXN7GaEQEn4tZkWF
QHos+329JfO4SSSQQII+f15mbuM791kp9ASDuqCCGZwFQ608ZmhlDKy7EQIDAQAB
o28wbTAdBgNVHQ4EFgQUfU1BMPSqb1ganbxQiriKuS0+dFkwHwYDVR0jBBgwFoAU
fU1BMPSqb1ganbxQiriKuS0+dFkwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzAR
gg9jZG4uZXhhbXBsZS5jb20wDQYJKoZIhvcNAQELBQADggEBAEPBPEKmWaUiYJPI
vJw+0g4P11MlewMFR1V/fOmQB5tQOvgUlXijIme1t7FmQZsbbuQ+ZU1xuod5gDvu
VGarov0DKhItq8xX+PYa306V4ZIauPUb/f0aSgoxdCCFqdOqSXq7tUZRBRzh+r5o
O8RjmdcqHpzXqk/jEssEwYCk9NXah5WUl4+J8dKvb+MUfQgs+f2zi8X/BfB+l6Lo
oiXZAGiCdIUsE7y/bWDnDLIKCaB094XAjPU7MLicVRBrj8363zj2X3VPJiDPMeuv
2/S8YJsC1JvwAKHEFjVYvdW5wzuZx4GMIj8Db4wF8C5R/7ZPRnwuybdNIo6rh/BL
YegI07g=
-----END CERTIFICATE-----`;

const MATCH_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCx0ARc9HWlnfhJ
tFYnRmWHaaIkHT+nBbvJICzuny0+Gyl1+PcN3ObX9MWykTfPzOmlU4VWU2qoN1Pd
hBPZceBYAGFv2ZYavRW5WuEneUR4NG3w1bKfwzvoj/XpC1NUtrfl6VjwSucdA4oY
gRgmHzKumOFc4SIjgnDy9AkKgIGJM0Uxwn4BR+mobh7Opp5CzrZi53FOCrDegFD9
K2e1rq8F9EPZ0Fx5SOSWOWkExIn4qcKNPBxuqezjcvDJSAFDUYoI2bDev7k+Sw2Z
c3sZoRASfi1mRYVAeiz7fb0l87hJJJBAgj5/XmZu4zv3WSn0BIO6oIIZnAVDrTxm
aGUMrLsRAgMBAAECggEABeiZaIRYD3WRHVPghAQXFhmYwXX2WkS6wXtv+srvzC9H
YKvx+7QyOI1h72XbcqyGvA9rMBvsAKR8BTGhHjnmQE5c7oROtFtBqEvgjPj+4Tau
y5CyU5Q/fqIgBAs0DO3YbQukwLFgfiqSsW9Cv+uL+djLLlSt13u7aJta3I46H7a1
/2thRNhZr5X1yBCJuc7v+C2TmrXULbdGhxnNY5KjFf7t987sqb+mQUi9sL//C8LP
cjF0Rj0ESrr5v+fLFz+wmbJt4XiatDsO1ZpsiywWzERsm2ZaP1K/D+HuwoYGvySf
L3A3y4gUgHq6cR01TOoOFDUA7fBjG0n3X06yDmcGBQKBgQDcMSm1XHGihLwXD7gt
Pa0CIx4bBJojqZSnjkHZx24xOrrZsPbLbP/zXlBJPKoQw1MAG4HRxDX+1DQFbkRA
4QGrjeoidRF7uAkr+WZgZB6fBunfn75Dmc5wieW+/gi2FgWyfB/E067GRFkFHxtE
R0xRxAPPKAWLvdpMA6QMGjuOZQKBgQDOuozFcYpsaT1vCs2rQYjS4y3XNVEPgihv
72rN+2osqr+icHO18GrqHUGOV0KryNNPvfFea+F0t1+K42Zg5aTZDoT8XZMQqwzE
8+yGZ7uiZ6BPFtnR3gnwROykrJnlHWsPfBnq/cghpK3mkyl7gqcXkkV1f/coAj6o
LSeyAs1JPQKBgEo/nbPVJ1BI9+/C0jUXLgahdt5fb+aEoWbatmPMNuEMz8LmRGIW
MDyNWf9IIISkiJFptR3ZzudOAPiv1P4XoWuK4B+cYDfat+UHJTltqVGwkB5jDFJZ
Q9548Wq02JUl2ef0qPXC95VNqMLsWVJtxFNyCGLLOQuFCl5FgATAt8JtAoGBAKJu
hcllqyP/lNu5G1zig0VgZ1ZfeC+9T1SUQ9FRKF2sVCKoROLB4t/M2QOkoKglhZN0
ZUCRd3aj1phkkL618c7yz58TT0ibfc8K8d+xhgbXcWhzRfbWheyZ226Qh+M0ODjU
g/DWMvfsUw+GteNsBypILfdi8qonCWBPCo+eD/rpAoGBANeQrnNPUYGafxoyao65
61EpDwukiO/x/7brnI2b3lgvZKFerlGhrkwr9NnwqhyUURf2aDnNE0pc6qq06EYJ
DKeio5iLNsVoi2EgoEAKQqlLusS4OZFzWmY9qRdvnv49H8WGrSp/0asQIcMVmiIo
8/sJVeDs0E+sVz2cHH62lWsb
-----END PRIVATE KEY-----`;

const OTHER_CERT = `-----BEGIN CERTIFICATE-----
MIIDNzCCAh+gAwIBAgIUP3eWiDfB/4xN6dFB7GVcIRcufIkwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRb3RoZXIuZXhhbXBsZS5jb20wHhcNMjYwODMwMDkzMDUw
WhcNMzYwODI3MDkzMDUwWjAcMRowGAYDVQQDDBFvdGhlci5leGFtcGxlLmNvbTCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK6Z0De4ewiK8aSXq8qUvIol
sJM98SM0y0N5uLM1AnOscaVjlvKf+iMQnDcts5iGztZa93Ienf4ckB3PcEJSUZ79
PoBhw6nB65nw7yx/qfgldEKESUrp8mr8piQInKAqAjq0VVkGjMnfyPWqOVsvhUap
85oR99As/LV41WMxvyk4XsqhvgOKRPp52oM04kgyxgbVcJpIHO6HmpHcaMASc8QO
YeJ6/p58e6FYEe8n9PoAYDaStotEVHCngGR++elhi8rja/MPwgUjmYP5poIp6piT
TiP0IbOf/9kTnVKPF2uzt+KFQun+nAXpbLsKygELiXG5t6XmZ1mrZp+34TtFD2EC
AwEAAaNxMG8wHQYDVR0OBBYEFO+VnyflluZ/kE1Wit6/NXgm4GxHMB8GA1UdIwQY
MBaAFO+VnyflluZ/kE1Wit6/NXgm4GxHMA8GA1UdEwEB/wQFMAMBAf8wHAYDVR0R
BBUwE4IRb3RoZXIuZXhhbXBsZS5jb20wDQYJKoZIhvcNAQELBQADggEBAE2CiwgI
O+kAq0P/xlcUY5ADsliaxwEqBAsKMH+qCzPR6d61XjrKstf0teVnDgg1TUti4Nwo
04B5T3acU6kS8Bp1LtJqmAnJZvB45hW8lVep2hvkCCr2YzI0bsekUIIcu2tVOuqF
n3eVZ55255mqn2CFE3eBlYCbWDgC+RMFTIJK14dfqvHjUgGmp79akB3z5uhoGnxq
h5y0jaS/Q1vgm7CS6WUcSXe8qCsi43Lsx/GtckYvdI+yhTecMnfcvVTVofTukHWO
puSSJdBgOlKM8cye375zdDXEusf+e6rDxy+u1QO5uImn/fP7TFb5+V8Gla4ApZeB
niCnqW8IXyc6GmI=
-----END CERTIFICATE-----`;

const OTHER_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCumdA3uHsIivGk
l6vKlLyKJbCTPfEjNMtDebizNQJzrHGlY5byn/ojEJw3LbOYhs7WWvdyHp3+HJAd
z3BCUlGe/T6AYcOpweuZ8O8sf6n4JXRChElK6fJq/KYkCJygKgI6tFVZBozJ38j1
qjlbL4VGqfOaEffQLPy1eNVjMb8pOF7Kob4DikT6edqDNOJIMsYG1XCaSBzuh5qR
3GjAEnPEDmHiev6efHuhWBHvJ/T6AGA2kraLRFRwp4BkfvnpYYvK42vzD8IFI5mD
+aaCKeqYk04j9CGzn//ZE51Sjxdrs7fihULp/pwF6Wy7CsoBC4lxubel5mdZq2af
t+E7RQ9hAgMBAAECggEACJvY4lvG5TLvRdhHRiPImrR6XP2EMuIwK3wy7n3B8zDL
dwYkCS54x4XSzf2uNJULrxH+erKmbkMQ8AdXAk4gwXVnFtll1lbou5xfjpLKL0wE
IXYi+aid+pxzwfm9ZJWYVTX9sfgFX7wYTSnpeLotGMDZxqegJQmIJEJ4SFMe7nSe
KFVM7La4q51/yVJ521o2OSoiYP7E+jOnhCElyxKzyolV975R21/gg9vQWuTeRkp3
3BI/Os7lvBkd3FIutngVID5w2S15dSTqjUIVEkmHW696xDrZ0l2cIyVwXCtbp6qC
yu7p/DnJB4xzQMub3jo+rC/9BQykBbOM2c2lpYXBKQKBgQDk+fqJ2reCpsO0PliJ
rMlLaVqYu4jZqjqO5+F/SQ01QyEOtqHTCN9Lv2s7EHcFMzaF+0ujWu36KqKfrtg0
CV4RAIuc1D4P9C27Fk5Nn6rnUFb53t1wxFQGUx66LzfFuP+sYquRzAK/momZohn7
knGuy3Rlh0eo24RIwNjjXXYRZwKBgQDDNP52SMCWF9t8MEtgwR4Jy+B/a049Aqc5
oZUkLdSwwKPDy6W0xbKjn6roZs6h4u74ZlB6knWus1V6gIPVFlnrQ1OM0EGCiRZt
flyf/7VxCyqnG9ETSahPcrZW1iVr+OIC7zXIh6/q5Bm6EcuEtq+mECrsNTMSmhLY
JtHv1I9z9wKBgFWIb6dJNV2vr9FHrMkY60SpQTdmblNovGEfi2OBxVZNEi8t17s+
SDNCeOriVqNxov9fhLyrvdPCU2c05/xgN2xAeOaHfft1qhOF3JAwgaXQo/zI3I1A
OWb3a7X+52WLmq4pWY+n1qr+LkJehDguVxsFUyCN7R3Nilem+h3MjssnAoGAOAt/
A3bf1DgFTCKRgbXwad+fFPY6AEpCuMkriLef2R915UES0lPwdgnhh9f8e34sHiVB
9e8W2pGieQls0EEaj/FEi6k/Jbs2NTmSXl2MOmh6VoAmBuOe7zCAKW5SUC2ktjL3
vhs25rmWqVVymSfaRlNd/3NGtpCF2IlMvQ7KIQECgYEA3SqcfM8mQpdHSviuKHr5
9p3dxgnqX2GPL+D7NkWMhy2o6g8/f3S+DVSEayd3ELaSiGPxCt1YYm+IcMiVGzWG
cPYJ5AEy9MpSvsecMzgi1eo51HlcW59q0WFYbBCEEhGZ3TjbCfLZbqox3mcSs2cz
J8Gp7mKjq6ef9xW/W9JJtLA=
-----END PRIVATE KEY-----`;

// Two small standalone TLS servers stand in for what Traefik would present:
// one server's certificate matches the domain under test (representing an
// issued ACME cert), the other doesn't (representing Traefik's fallback
// cert, or another domain's cert) — this never touches a real network
// domain.
describe('checkTlsCertificate', () => {
  let matchServer: tls.Server;
  let mismatchServer: tls.Server;
  let matchPort: number;
  let mismatchPort: number;

  beforeAll(async () => {
    matchServer = tls.createServer({ cert: MATCH_CERT, key: MATCH_KEY }, (socket) => socket.end());
    mismatchServer = tls.createServer({ cert: OTHER_CERT, key: OTHER_KEY }, (socket) => socket.end());

    await Promise.all([
      new Promise<void>((resolve) => matchServer.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => mismatchServer.listen(0, '127.0.0.1', resolve)),
    ]);

    const matchAddress = matchServer.address();
    const mismatchAddress = mismatchServer.address();
    if (matchAddress === null || typeof matchAddress === 'string' || mismatchAddress === null || typeof mismatchAddress === 'string') {
      throw new Error('expected network addresses');
    }
    matchPort = matchAddress.port;
    mismatchPort = mismatchAddress.port;
  });

  afterAll(() => {
    matchServer.close();
    mismatchServer.close();
  });

  it('reports valid with the certificate expiry when the served cert matches the domain', async () => {
    const result = await checkTlsCertificate('cdn.example.com', { host: '127.0.0.1', port: matchPort });
    expect(result.valid).toBe(true);
    expect(result.validTo?.getFullYear()).toBeGreaterThan(2030);
  });

  it('reports invalid when the served certificate does not match the requested domain', async () => {
    const result = await checkTlsCertificate('cdn.example.com', { host: '127.0.0.1', port: mismatchPort });
    expect(result.valid).toBe(false);
  });

  it('reports invalid when the connection fails outright', async () => {
    const result = await checkTlsCertificate('cdn.example.com', { host: '127.0.0.1', port: 1, timeoutMs: 500 });
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/scheduler test:unit -- tls-check`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement `tls-check.ts`**

Create `apps/scheduler/src/domains/tls-check.ts`:

```ts
import * as tls from 'node:tls';

export interface TlsCertificateResult {
  valid: boolean;
  validTo?: Date;
}

export interface CheckTlsCertificateOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
}

// The only reliable way to confirm a Let's Encrypt certificate was actually
// issued and installed: connect with the domain as SNI (exactly what a real
// browser does) and check the certificate Traefik hands back. Traefik does
// not expose its ACME store's contents over its API (by design, for
// security), so there is no "ask Traefik whether it has a cert yet" call to
// make instead.
export function checkTlsCertificate(domain: string, opts: CheckTlsCertificateOptions = {}): Promise<TlsCertificateResult> {
  const { host = domain, port = 443, timeoutMs = 5000 } = opts;
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, servername: domain, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        const names = [
          cert.subject?.CN,
          ...(cert.subjectaltname?.split(', ').map((entry) => entry.replace(/^DNS:/, '')) ?? []),
        ].filter((name): name is string => Boolean(name));
        const matches = names.includes(domain);
        socket.end();
        resolve(matches && cert.valid_to ? { valid: true, validTo: new Date(cert.valid_to) } : { valid: false });
      },
    );
    socket.on('error', () => resolve({ valid: false }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ valid: false });
    });
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/scheduler test:unit -- tls-check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/scheduler/src/domains/dns-check.ts apps/scheduler/src/domains/dns-check.test.ts apps/scheduler/src/domains/tls-check.ts apps/scheduler/src/domains/tls-check.test.ts
git commit -m "feat(scheduler): add DNS resolution and TLS certificate verification primitives"
```

---

### Task 7: Scheduler — `DomainVerificationService`

**Files:**
- Create: `apps/scheduler/src/domains/domain-verification.service.ts`
- Test: `apps/scheduler/src/domains/domain-verification.service.integration.test.ts`

**Interfaces:**
- Consumes: `PRISMA`/`REDIS`/`APP_ENV` DI tokens, `resolvesToEdge`/`checkTlsCertificate` (Task 6).
- Produces: `DomainVerificationService.checkOne(domain: ZoneDomain): Promise<ZoneDomain>` and `.checkPending(): Promise<{ checked: number; transitioned: number }>`, consumed by Task 8 (cron) and Task 9 (internal endpoint).

- [ ] **Step 1: Write the failing integration test**

Create `apps/scheduler/src/domains/domain-verification.service.integration.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as tls from 'node:tls';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { DomainVerificationService } from './domain-verification.service.js';
import type { TlsCertificateResult } from './tls-check.js';

const MATCH_CERT = `-----BEGIN CERTIFICATE-----
MIIDMTCCAhmgAwIBAgIUM8SXiBgTsQZAu9YRc8AtO3o7d5wwDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPY2RuLmV4YW1wbGUuY29tMB4XDTI2MDgzMDA5MzA1MFoX
DTM2MDgyNzA5MzA1MFowGjEYMBYGA1UEAwwPY2RuLmV4YW1wbGUuY29tMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsdAEXPR1pZ34SbRWJ0Zlh2miJB0/
pwW7ySAs7p8tPhspdfj3Ddzm1/TFspE3z8zppVOFVlNqqDdT3YQT2XHgWABhb9mW
Gr0VuVrhJ3lEeDRt8NWyn8M76I/16QtTVLa35elY8ErnHQOKGIEYJh8yrpjhXOEi
I4Jw8vQJCoCBiTNFMcJ+AUfpqG4ezqaeQs62YudxTgqw3oBQ/Stnta6vBfRD2dBc
eUjkljlpBMSJ+KnCjTwcbqns43LwyUgBQ1GKCNmw3r+5PksNmXN7GaEQEn4tZkWF
QHos+329JfO4SSSQQII+f15mbuM791kp9ASDuqCCGZwFQ608ZmhlDKy7EQIDAQAB
o28wbTAdBgNVHQ4EFgQUfU1BMPSqb1ganbxQiriKuS0+dFkwHwYDVR0jBBgwFoAU
fU1BMPSqb1ganbxQiriKuS0+dFkwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzAR
gg9jZG4uZXhhbXBsZS5jb20wDQYJKoZIhvcNAQELBQADggEBAEPBPEKmWaUiYJPI
vJw+0g4P11MlewMFR1V/fOmQB5tQOvgUlXijIme1t7FmQZsbbuQ+ZU1xuod5gDvu
VGarov0DKhItq8xX+PYa306V4ZIauPUb/f0aSgoxdCCFqdOqSXq7tUZRBRzh+r5o
O8RjmdcqHpzXqk/jEssEwYCk9NXah5WUl4+J8dKvb+MUfQgs+f2zi8X/BfB+l6Lo
oiXZAGiCdIUsE7y/bWDnDLIKCaB094XAjPU7MLicVRBrj8363zj2X3VPJiDPMeuv
2/S8YJsC1JvwAKHEFjVYvdW5wzuZx4GMIj8Db4wF8C5R/7ZPRnwuybdNIo6rh/BL
YegI07g=
-----END CERTIFICATE-----`;

const MATCH_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCx0ARc9HWlnfhJ
tFYnRmWHaaIkHT+nBbvJICzuny0+Gyl1+PcN3ObX9MWykTfPzOmlU4VWU2qoN1Pd
hBPZceBYAGFv2ZYavRW5WuEneUR4NG3w1bKfwzvoj/XpC1NUtrfl6VjwSucdA4oY
gRgmHzKumOFc4SIjgnDy9AkKgIGJM0Uxwn4BR+mobh7Opp5CzrZi53FOCrDegFD9
K2e1rq8F9EPZ0Fx5SOSWOWkExIn4qcKNPBxuqezjcvDJSAFDUYoI2bDev7k+Sw2Z
c3sZoRASfi1mRYVAeiz7fb0l87hJJJBAgj5/XmZu4zv3WSn0BIO6oIIZnAVDrTxm
aGUMrLsRAgMBAAECggEABeiZaIRYD3WRHVPghAQXFhmYwXX2WkS6wXtv+srvzC9H
YKvx+7QyOI1h72XbcqyGvA9rMBvsAKR8BTGhHjnmQE5c7oROtFtBqEvgjPj+4Tau
y5CyU5Q/fqIgBAs0DO3YbQukwLFgfiqSsW9Cv+uL+djLLlSt13u7aJta3I46H7a1
/2thRNhZr5X1yBCJuc7v+C2TmrXULbdGhxnNY5KjFf7t987sqb+mQUi9sL//C8LP
cjF0Rj0ESrr5v+fLFz+wmbJt4XiatDsO1ZpsiywWzERsm2ZaP1K/D+HuwoYGvySf
L3A3y4gUgHq6cR01TOoOFDUA7fBjG0n3X06yDmcGBQKBgQDcMSm1XHGihLwXD7gt
Pa0CIx4bBJojqZSnjkHZx24xOrrZsPbLbP/zXlBJPKoQw1MAG4HRxDX+1DQFbkRA
4QGrjeoidRF7uAkr+WZgZB6fBunfn75Dmc5wieW+/gi2FgWyfB/E067GRFkFHxtE
R0xRxAPPKAWLvdpMA6QMGjuOZQKBgQDOuozFcYpsaT1vCs2rQYjS4y3XNVEPgihv
72rN+2osqr+icHO18GrqHUGOV0KryNNPvfFea+F0t1+K42Zg5aTZDoT8XZMQqwzE
8+yGZ7uiZ6BPFtnR3gnwROykrJnlHWsPfBnq/cghpK3mkyl7gqcXkkV1f/coAj6o
LSeyAs1JPQKBgEo/nbPVJ1BI9+/C0jUXLgahdt5fb+aEoWbatmPMNuEMz8LmRGIW
MDyNWf9IIISkiJFptR3ZzudOAPiv1P4XoWuK4B+cYDfat+UHJTltqVGwkB5jDFJZ
Q9548Wq02JUl2ef0qPXC95VNqMLsWVJtxFNyCGLLOQuFCl5FgATAt8JtAoGBAKJu
hcllqyP/lNu5G1zig0VgZ1ZfeC+9T1SUQ9FRKF2sVCKoROLB4t/M2QOkoKglhZN0
ZUCRd3aj1phkkL618c7yz58TT0ibfc8K8d+xhgbXcWhzRfbWheyZ226Qh+M0ODjU
g/DWMvfsUw+GteNsBypILfdi8qonCWBPCo+eD/rpAoGBANeQrnNPUYGafxoyao65
61EpDwukiO/x/7brnI2b3lgvZKFerlGhrkwr9NnwqhyUURf2aDnNE0pc6qq06EYJ
DKeio5iLNsVoi2EgoEAKQqlLusS4OZFzWmY9qRdvnv49H8WGrSp/0asQIcMVmiIo
8/sJVeDs0E+sVz2cHH62lWsb
-----END PRIVATE KEY-----`;

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const env = { EDGE_HOSTNAME: 'edge.rivocloud.dev', DOMAIN_DNS_TIMEOUT_MINUTES: 30, DOMAIN_SSL_TIMEOUT_MINUTES: 15 };

async function seedZoneAndDomain(overrides: Partial<{ sslStatus: string; createdAt: Date; verifiedAt: Date | null }> = {}) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  const zone = await prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
  });
  const domain = await prisma.zoneDomain.create({
    data: {
      zoneId: zone.id,
      domain: `cdn-${randomUUID()}.example.com`,
      sslStatus: overrides.sslStatus ?? 'pending_dns',
      createdAt: overrides.createdAt,
      verifiedAt: overrides.verifiedAt,
    },
  });
  return { zone, domain };
}

describe('DomainVerificationService', () => {
  beforeEach(async () => {
    await prisma.zoneDomain.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
    await prisma.jobRun.deleteMany();
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('transitions pending_dns to pending_ssl and writes zone_host when DNS resolves', async () => {
    const { zone, domain } = await seedZoneAndDomain();
    const resolveDns = async () => true;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);

    expect(updated.sslStatus).toBe('pending_ssl');
    expect(updated.verifiedAt).not.toBeNull();
    expect(await redis.get(`zone_host:${domain.domain}`)).toBe(zone.id);
  });

  it('leaves pending_dns unchanged when DNS has not resolved yet and the timeout has not elapsed', async () => {
    const { domain } = await seedZoneAndDomain();
    const resolveDns = async () => false;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('pending_dns');
  });

  it('flips pending_dns to error once the DNS timeout has elapsed', async () => {
    const timedOutEnv = { ...env, DOMAIN_DNS_TIMEOUT_MINUTES: 30 };
    const { domain } = await seedZoneAndDomain({ createdAt: new Date(Date.now() - 31 * 60 * 1000) });
    const resolveDns = async () => false;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, timedOutEnv as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('error');
    expect(updated.sslError).toContain('DNS');
  });

  it('transitions pending_ssl to active with the certificate expiry when the TLS handshake matches', async () => {
    const { domain } = await seedZoneAndDomain({ sslStatus: 'pending_ssl', verifiedAt: new Date() });
    const resolveDns = async () => true;
    const validTo = new Date('2036-08-27T00:00:00Z');
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: true, validTo });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('active');
    expect(updated.certExpiresAt?.toISOString()).toBe(validTo.toISOString());
  });

  it('flips pending_ssl to error once the SSL timeout has elapsed', async () => {
    const { domain } = await seedZoneAndDomain({
      sslStatus: 'pending_ssl',
      verifiedAt: new Date(Date.now() - 16 * 60 * 1000),
    });
    const resolveDns = async () => true;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('error');
    expect(updated.sslError).toContain('Certificate');
  });

  it('an error domain that already resolved DNS retries at the SSL phase, not from scratch', async () => {
    const { domain } = await seedZoneAndDomain({ sslStatus: 'error', verifiedAt: new Date() });
    let dnsCalled = false;
    const resolveDns = async () => {
      dnsCalled = true;
      return true;
    };
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: true, validTo: new Date('2036-01-01') });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(dnsCalled).toBe(false);
    expect(updated.sslStatus).toBe('active');
  });

  it('an active domain is left unchanged', async () => {
    const { domain } = await seedZoneAndDomain({ sslStatus: 'active', verifiedAt: new Date() });
    const resolveDns = async () => true;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: true, validTo: new Date() });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('active');
  });

  it('checkPending records a JobRun and reports how many domains transitioned', async () => {
    await seedZoneAndDomain();
    await seedZoneAndDomain({ sslStatus: 'active' });
    const resolveDns = async () => true;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const result = await service.checkPending();
    expect(result.checked).toBe(1);
    expect(result.transitioned).toBe(1);

    const jobRuns = await prisma.jobRun.findMany({ where: { jobName: 'domain-dns-verification' } });
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0].status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/scheduler test:integration -- domain-verification.service`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `DomainVerificationService`**

Create `apps/scheduler/src/domains/domain-verification.service.ts`:

```ts
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PrismaClient, ZoneDomain } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { resolvesToEdge } from './dns-check.js';
import { checkTlsCertificate, type TlsCertificateResult } from './tls-check.js';

type ResolveDnsFn = (domain: string, edgeHostname: string) => Promise<boolean>;
type CheckTlsFn = (domain: string) => Promise<TlsCertificateResult>;

const JOB_NAME = 'domain-dns-verification';

@Injectable()
export class DomainVerificationService {
  private readonly logger = new Logger(DomainVerificationService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: AppEnv,
    // Overridable for tests (a fake DNS resolver, a TLS check pointed at a
    // local test server) — production callers get the real implementations
    // via these defaults. @Optional() tells Nest's DI container not to try
    // resolving a provider for a plain function type; it simply passes
    // `undefined`, which lets the JS default parameter apply.
    @Optional() private readonly resolveDns: ResolveDnsFn = resolvesToEdge,
    @Optional() private readonly checkTls: CheckTlsFn = (domain) => checkTlsCertificate(domain),
  ) {}

  // The single per-domain state machine, used both by the 30-second cron
  // sweep (checkPending, below) and by the CDN Service's manual "Verify"
  // action (Task 9's internal endpoint) so both paths share one
  // implementation of what "verified" actually means.
  async checkOne(domain: ZoneDomain): Promise<ZoneDomain> {
    // A domain stuck in 'error' resumes from whichever phase it last
    // succeeded at: verifiedAt is only ever set once DNS resolves, so its
    // presence means the failure happened at the SSL phase, not DNS.
    const effectiveStatus = domain.sslStatus === 'error' ? (domain.verifiedAt ? 'pending_ssl' : 'pending_dns') : domain.sslStatus;

    if (effectiveStatus === 'pending_dns') {
      return this.checkDns(domain);
    }
    if (effectiveStatus === 'pending_ssl') {
      return this.checkSsl(domain);
    }
    return domain;
  }

  async checkPending(): Promise<{ checked: number; transitioned: number }> {
    const jobRun = await this.db.jobRun.create({ data: { jobName: JOB_NAME } });
    let checked = 0;
    let transitioned = 0;
    try {
      const domains = await this.db.zoneDomain.findMany({
        where: { sslStatus: { in: ['pending_dns', 'pending_ssl'] } },
      });
      for (const domain of domains) {
        checked += 1;
        try {
          const updated = await this.checkOne(domain);
          if (updated.sslStatus !== domain.sslStatus) {
            transitioned += 1;
          }
        } catch (error) {
          this.logger.error(`domain verification failed for ${domain.domain}: ${(error as Error).message}`);
        }
      }
      await this.db.jobRun.update({
        where: { id: jobRun.id },
        data: { status: 'completed', completedAt: new Date(), metadata: { checked, transitioned } },
      });
    } catch (error) {
      await this.db.jobRun.update({
        where: { id: jobRun.id },
        data: { status: 'failed', completedAt: new Date(), error: (error as Error).message },
      });
      throw error;
    }
    return { checked, transitioned };
  }

  private async checkDns(domain: ZoneDomain): Promise<ZoneDomain> {
    const resolved = await this.resolveDns(domain.domain, this.env.EDGE_HOSTNAME);
    if (resolved) {
      await this.redis.set(`zone_host:${domain.domain}`, domain.zoneId);
      return this.db.zoneDomain.update({
        where: { id: domain.id },
        data: { sslStatus: 'pending_ssl', verifiedAt: new Date(), sslError: null },
      });
    }
    if (this.isTimedOut(domain.createdAt, this.env.DOMAIN_DNS_TIMEOUT_MINUTES)) {
      return this.db.zoneDomain.update({
        where: { id: domain.id },
        data: {
          sslStatus: 'error',
          sslError: `DNS did not resolve to ${this.env.EDGE_HOSTNAME} within ${this.env.DOMAIN_DNS_TIMEOUT_MINUTES} minutes`,
        },
      });
    }
    return domain;
  }

  private async checkSsl(domain: ZoneDomain): Promise<ZoneDomain> {
    const cert = await this.checkTls(domain.domain);
    if (cert.valid) {
      return this.db.zoneDomain.update({
        where: { id: domain.id },
        data: { sslStatus: 'active', certExpiresAt: cert.validTo, sslError: null },
      });
    }
    const since = domain.verifiedAt ?? domain.createdAt;
    if (this.isTimedOut(since, this.env.DOMAIN_SSL_TIMEOUT_MINUTES)) {
      return this.db.zoneDomain.update({
        where: { id: domain.id },
        data: { sslStatus: 'error', sslError: 'Certificate was not issued within the expected window' },
      });
    }
    return domain;
  }

  private isTimedOut(since: Date, minutes: number): boolean {
    return Date.now() - since.getTime() > minutes * 60 * 1000;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/scheduler test:integration -- domain-verification.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/scheduler/src/domains/domain-verification.service.ts apps/scheduler/src/domains/domain-verification.service.integration.test.ts
git commit -m "feat(scheduler): add DomainVerificationService state machine"
```

---

### Task 8: Scheduler — cron wiring

**Files:**
- Create: `apps/scheduler/src/domains/domain-verification.cron.ts`
- Test: `apps/scheduler/src/domains/domain-verification.cron.test.ts`
- Modify: `apps/scheduler/src/app.module.ts`

**Interfaces:**
- Consumes: `DomainVerificationService.checkPending` (Task 7).
- Produces: a `@Cron('*/30 * * * * *')` job that calls `checkPending()` every 30 seconds, matching the EDD's "polls DNS every 30 seconds."

- [ ] **Step 1: Write the failing test**

Create `apps/scheduler/src/domains/domain-verification.cron.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { DomainVerificationCron } from './domain-verification.cron.js';
import type { DomainVerificationService } from './domain-verification.service.js';

describe('DomainVerificationCron', () => {
  it('delegates to DomainVerificationService.checkPending on each tick', async () => {
    const checkPending = vi.fn().mockResolvedValue({ checked: 2, transitioned: 1 });
    const cron = new DomainVerificationCron({ checkPending } as unknown as DomainVerificationService);

    await cron.handleCron();

    expect(checkPending).toHaveBeenCalledOnce();
  });

  it('does not let a rejected checkPending crash the process', async () => {
    const checkPending = vi.fn().mockRejectedValue(new Error('boom'));
    const cron = new DomainVerificationCron({ checkPending } as unknown as DomainVerificationService);

    await expect(cron.handleCron()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/scheduler test:unit -- domain-verification.cron`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `DomainVerificationCron`**

Create `apps/scheduler/src/domains/domain-verification.cron.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DomainVerificationService } from './domain-verification.service.js';

@Injectable()
export class DomainVerificationCron {
  private readonly logger = new Logger(DomainVerificationCron.name);

  constructor(private readonly verification: DomainVerificationService) {}

  // EDD Section 5.8 / 6.2: "the Scheduler service performs a DNS lookup for
  // that domain every 30 seconds."
  @Cron('*/30 * * * * *')
  async handleCron(): Promise<void> {
    try {
      await this.verification.checkPending();
    } catch (error) {
      this.logger.error(`domain verification sweep failed: ${(error as Error).message}`);
    }
  }
}
```

In `apps/scheduler/src/app.module.ts`, add `ScheduleModule.forRoot()` and the cron provider (the `DomainsModule` import replaces this once Task 9 creates it — for now, add the cron directly to `AppModule` so this task's test suite reflects a real wiring; Task 9 will move it into `DomainsModule`):

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { DomainVerificationService } from './domains/domain-verification.service.js';
import { DomainVerificationCron } from './domains/domain-verification.cron.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, ScheduleModule.forRoot()],
  controllers: [HealthController],
  providers: [DomainVerificationService, DomainVerificationCron],
})
export class AppModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/scheduler test:unit -- domain-verification.cron`
Expected: PASS.

Also run `pnpm --filter @rivocloud/scheduler test:integration -- health` to confirm the app still boots cleanly with `ScheduleModule` added.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/scheduler/src/domains/domain-verification.cron.ts apps/scheduler/src/domains/domain-verification.cron.test.ts apps/scheduler/src/app.module.ts
git commit -m "feat(scheduler): run domain verification on a 30-second cron"
```

---

### Task 9: Scheduler — internal verify-now endpoint

**Files:**
- Create: `apps/scheduler/src/domains/internal-auth.guard.ts`
- Test: `apps/scheduler/src/domains/internal-auth.guard.test.ts`
- Create: `apps/scheduler/src/domains/domains-internal.controller.ts`
- Test: `apps/scheduler/src/domains/domains-internal.controller.integration.test.ts`
- Create: `apps/scheduler/src/domains/domains.module.ts`
- Modify: `apps/scheduler/src/app.module.ts`

**Interfaces:**
- Consumes: `APP_ENV`, `PRISMA`, `DomainVerificationService` (Task 7).
- Produces: `POST /internal/domains/:domainId/verify-now`, guarded by `X-Internal-Secret` — the endpoint Task 5's `SchedulerClient` calls.

- [ ] **Step 1: Write the failing guard test**

Create `apps/scheduler/src/domains/internal-auth.guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard.js';

function contextWithHeader(header: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-internal-secret': header } }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalAuthGuard', () => {
  const guard = new InternalAuthGuard({ INTERNAL_API_SECRET: 'correct-secret' } as never);

  it('allows a request with the correct secret', () => {
    expect(guard.canActivate(contextWithHeader('correct-secret'))).toBe(true);
  });

  it('rejects a request with the wrong secret', () => {
    expect(() => guard.canActivate(contextWithHeader('wrong-secret'))).toThrow(UnauthorizedException);
  });

  it('rejects a request with no secret header', () => {
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/scheduler test:unit -- internal-auth.guard`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `InternalAuthGuard`**

Create `apps/scheduler/src/domains/internal-auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.headers['x-internal-secret'] as string | undefined;
    if (secret !== this.env.INTERNAL_API_SECRET) {
      throw new UnauthorizedException('Missing or invalid X-Internal-Secret header');
    }
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/scheduler test:unit -- internal-auth.guard`
Expected: PASS.

- [ ] **Step 5: Write the failing `DomainsInternalController` integration test**

Create `apps/scheduler/src/domains/domains-internal.controller.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { APP_ENV } from '../app-env.token.js';
import { DomainVerificationService } from './domain-verification.service.js';

describe('DomainsInternalController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.zoneDomain.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedDomain() {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    const zone = await prisma.pullZone.create({
      data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
    });
    return prisma.zoneDomain.create({ data: { zoneId: zone.id, domain: `cdn-${randomUUID()}.example.com` } });
  }

  it('rejects a request without the internal secret', async () => {
    const domain = await seedDomain();
    const response = await request(app.getHttpServer()).post(`/internal/domains/${domain.id}/verify-now`);
    expect(response.status).toBe(401);
  });

  it('404s for an unknown domain id', async () => {
    const secret = app.get(APP_ENV).INTERNAL_API_SECRET;
    const response = await request(app.getHttpServer())
      .post(`/internal/domains/${randomUUID()}/verify-now`)
      .set('X-Internal-Secret', secret);
    expect(response.status).toBe(404);
  });

  it('runs verification immediately and returns the updated domain', async () => {
    const domain = await seedDomain();
    const secret = app.get(APP_ENV).INTERNAL_API_SECRET;

    const response = await request(app.getHttpServer())
      .post(`/internal/domains/${domain.id}/verify-now`)
      .set('X-Internal-Secret', secret);

    expect(response.status).toBe(201);
    expect(response.body.id).toBe(domain.id);
    // A freshly seeded domain's DNS won't actually resolve to RivoCloud, so
    // it stays pending_dns — this asserts the endpoint truly ran checkOne
    // rather than just echoing the input back unchanged in some other way.
    expect(response.body.sslStatus).toBe('pending_dns');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/scheduler test:integration -- domains-internal.controller`
Expected: FAIL — route doesn't exist.

- [ ] **Step 7: Implement `DomainsInternalController` and `DomainsModule`, wire into `AppModule`**

Create `apps/scheduler/src/domains/domains-internal.controller.ts`:

```ts
import { Controller, Inject, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { InternalAuthGuard } from './internal-auth.guard.js';
import { DomainVerificationService } from './domain-verification.service.js';

@Controller('internal/domains')
@UseGuards(InternalAuthGuard)
export class DomainsInternalController {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly verification: DomainVerificationService,
  ) {}

  @Post(':domainId/verify-now')
  async verifyNow(@Param('domainId') domainId: string) {
    const domain = await this.db.zoneDomain.findUnique({ where: { id: domainId } });
    if (!domain) {
      throw new NotFoundException('Domain not found');
    }
    return this.verification.checkOne(domain);
  }
}
```

Create `apps/scheduler/src/domains/domains.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DomainsInternalController } from './domains-internal.controller.js';
import { InternalAuthGuard } from './internal-auth.guard.js';
import { DomainVerificationService } from './domain-verification.service.js';
import { DomainVerificationCron } from './domain-verification.cron.js';

@Module({
  controllers: [DomainsInternalController],
  providers: [InternalAuthGuard, DomainVerificationService, DomainVerificationCron],
})
export class DomainsModule {}
```

Update `apps/scheduler/src/app.module.ts` to import `DomainsModule` instead of declaring `DomainVerificationService`/`DomainVerificationCron` directly (Task 8 put them straight on `AppModule` as an interim step — this consolidates them into the proper module):

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthController } from './health/health.controller.js';
import { DomainsModule } from './domains/domains.module.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, ScheduleModule.forRoot(), DomainsModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/scheduler test:integration -- domains-internal.controller`
Expected: PASS.

Also re-run the full Scheduler suite to confirm nothing regressed from moving providers into `DomainsModule`:

Run: `pnpm --filter @rivocloud/scheduler test:unit && pnpm --filter @rivocloud/scheduler test:integration`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/scheduler/src/domains/internal-auth.guard.ts apps/scheduler/src/domains/internal-auth.guard.test.ts apps/scheduler/src/domains/domains-internal.controller.ts apps/scheduler/src/domains/domains-internal.controller.integration.test.ts apps/scheduler/src/domains/domains.module.ts apps/scheduler/src/app.module.ts
git commit -m "feat(scheduler): add internal verify-now endpoint for manual re-checks"
```

---

### Task 10: Dashboard — types, validation, proxy routes, and hooks

**Files:**
- Modify: `apps/dashboard/src/lib/types.ts`
- Modify: `apps/dashboard/src/lib/validation.ts`
- Create: `apps/dashboard/src/app/api/zones/[zoneId]/domains/route.ts`
- Create: `apps/dashboard/src/app/api/zones/[zoneId]/domains/[domainId]/route.ts`
- Create: `apps/dashboard/src/app/api/zones/[zoneId]/domains/[domainId]/verify/route.ts`
- Create: `apps/dashboard/src/hooks/use-domains.ts`, `use-create-domain.ts`, `use-delete-domain.ts`, `use-verify-domain.ts`

**Interfaces:**
- Consumes: `proxyToBackend` (existing, `@/lib/proxy`), `getEnv().CDN_SERVICE_URL` (existing), `apiFetch`/`errorMessage` (existing, `@/lib/http`).
- Produces: `ZoneDomain` type, `createDomainSchema`, `useDomains(zoneId)`, `useCreateDomain(zoneId)`, `useDeleteDomain(zoneId)`, `useVerifyDomain(zoneId)` — all consumed by Task 11's UI component.

- [ ] **Step 1: Add the `ZoneDomain` type**

In `apps/dashboard/src/lib/types.ts`, add after the `Zone` interface:

```ts
export interface ZoneDomain {
  id: string;
  zoneId: string;
  domain: string;
  sslStatus: 'pending_dns' | 'pending_ssl' | 'active' | 'error';
  sslError: string | null;
  certExpiresAt: string | null;
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
  cnameTarget: string;
}
```

- [ ] **Step 2: Add the validation schema**

In `apps/dashboard/src/lib/validation.ts`, add after `updateZoneSchema`:

```ts
const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export const createDomainSchema = z.object({
  domain: z.string().min(1).max(253).regex(HOSTNAME_PATTERN, 'Enter a valid hostname, e.g. cdn.your-company.com'),
});
export type CreateDomainInput = z.infer<typeof createDomainSchema>;
```

- [ ] **Step 3: Add the proxy routes**

Create `apps/dashboard/src/app/api/zones/[zoneId]/domains/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ zoneId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { zoneId } = await params;
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones/${encodeURIComponent(zoneId)}/domains`);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { zoneId } = await params;
  const body = await request.text();
  return proxyToBackend(getEnv().CDN_SERVICE_URL, `/api/v1/zones/${encodeURIComponent(zoneId)}/domains`, {
    method: 'POST',
    body,
  });
}
```

Create `apps/dashboard/src/app/api/zones/[zoneId]/domains/[domainId]/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ zoneId: string; domainId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { zoneId, domainId } = await params;
  return proxyToBackend(
    getEnv().CDN_SERVICE_URL,
    `/api/v1/zones/${encodeURIComponent(zoneId)}/domains/${encodeURIComponent(domainId)}`,
    { method: 'DELETE' },
  );
}
```

Create `apps/dashboard/src/app/api/zones/[zoneId]/domains/[domainId]/verify/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

interface RouteParams {
  params: Promise<{ zoneId: string; domainId: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { zoneId, domainId } = await params;
  return proxyToBackend(
    getEnv().CDN_SERVICE_URL,
    `/api/v1/zones/${encodeURIComponent(zoneId)}/domains/${encodeURIComponent(domainId)}/verify`,
    { method: 'POST' },
  );
}
```

- [ ] **Step 4: Add the hooks**

Create `apps/dashboard/src/hooks/use-domains.ts`:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { ZoneDomain } from '@/lib/types';

export function useDomains(zoneId: string) {
  return useQuery({
    queryKey: ['zones', zoneId, 'domains'],
    queryFn: () => apiFetch<ZoneDomain[]>(`/api/zones/${zoneId}/domains`),
  });
}
```

Create `apps/dashboard/src/hooks/use-create-domain.ts`:

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { CreateDomainInput } from '@/lib/validation';
import type { ZoneDomain } from '@/lib/types';

export function useCreateDomain(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDomainInput) =>
      apiFetch<ZoneDomain>(`/api/zones/${zoneId}/domains`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId, 'domains'] });
    },
  });
}
```

Create `apps/dashboard/src/hooks/use-delete-domain.ts`:

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';

export function useDeleteDomain(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) =>
      apiFetch<{ success: true }>(`/api/zones/${zoneId}/domains/${domainId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId, 'domains'] });
    },
  });
}
```

Create `apps/dashboard/src/hooks/use-verify-domain.ts`:

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type { ZoneDomain } from '@/lib/types';

export function useVerifyDomain(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) =>
      apiFetch<ZoneDomain>(`/api/zones/${zoneId}/domains/${domainId}/verify`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zones', zoneId, 'domains'] });
    },
  });
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @rivocloud/dashboard typecheck`
Expected: PASS (no test framework exercises proxy routes/hooks directly in this repo's existing patterns — `zone-list.test.tsx` etc. test components, not routes/hooks — so typechecking is this task's verification step; Task 11's component test is what exercises these hooks at runtime, via mocked `fetch`).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/types.ts apps/dashboard/src/lib/validation.ts apps/dashboard/src/app/api/zones/\[zoneId\]/domains apps/dashboard/src/hooks/use-domains.ts apps/dashboard/src/hooks/use-create-domain.ts apps/dashboard/src/hooks/use-delete-domain.ts apps/dashboard/src/hooks/use-verify-domain.ts
git commit -m "feat(dashboard): add domains types, validation, proxy routes, and hooks"
```

---

### Task 11: Dashboard — Custom Domains UI on the zone detail page

**Files:**
- Create: `apps/dashboard/src/components/zones/zone-domains.tsx`
- Test: `apps/dashboard/src/components/zones/zone-domains.test.tsx`
- Modify: `apps/dashboard/src/components/zones/zone-detail.tsx`

**Interfaces:**
- Consumes: `useDomains`/`useCreateDomain`/`useDeleteDomain`/`useVerifyDomain` (Task 10), `Badge`/`Button`/`Input`/`Label`/`Card`/`Table` (existing `@/components/ui/*`).
- Produces: `<ZoneDomains zoneId={string} />`, rendered inside `ZoneDetail`.

- [ ] **Step 1: Write the failing component test**

Create `apps/dashboard/src/components/zones/zone-domains.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ZoneDomains } from './zone-domains';
import type { ZoneDomain } from '@/lib/types';

function makeDomain(overrides: Partial<ZoneDomain> = {}): ZoneDomain {
  return {
    id: 'domain-1',
    zoneId: 'zone-1',
    domain: 'cdn.example.com',
    sslStatus: 'pending_dns',
    sslError: null,
    certExpiresAt: null,
    isPrimary: false,
    verifiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    cnameTarget: 'edge.rivocloud.dev',
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ZoneDomains', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders an empty state and the CNAME instructions when there are no domains', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    expect(await screen.findByText(/no custom domains yet/i)).toBeInTheDocument();
  });

  it('renders a domain row with its status badge', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([makeDomain({ sslStatus: 'active' })]), { status: 200 }));
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    expect(await screen.findByText('cdn.example.com')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows the sslError when a domain is in the error state', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([makeDomain({ sslStatus: 'error', sslError: 'DNS did not resolve' })]), { status: 200 }),
    );
    renderWithClient(<ZoneDomains zoneId="zone-1" />);

    expect(await screen.findByText('DNS did not resolve')).toBeInTheDocument();
  });

  it('submits a new domain and shows the CNAME instructions returned by the API', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeDomain()), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([makeDomain()]), { status: 200 }));

    renderWithClient(<ZoneDomains zoneId="zone-1" />);
    await screen.findByText(/no custom domains yet/i);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/domain/i), 'cdn.example.com');
    await user.click(screen.getByRole('button', { name: /add domain/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/zones/zone-1/domains',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('calls verify when the Verify button is clicked', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([makeDomain()]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(makeDomain({ sslStatus: 'pending_ssl' })), { status: 201 }));

    renderWithClient(<ZoneDomains zoneId="zone-1" />);
    const verifyButton = await screen.findByRole('button', { name: /verify/i });

    const user = userEvent.setup();
    await user.click(verifyButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/zones/zone-1/domains/domain-1/verify',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/dashboard test:unit -- zone-domains`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `ZoneDomains`**

Create `apps/dashboard/src/components/zones/zone-domains.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createDomainSchema } from '@/lib/validation';
import { useDomains } from '@/hooks/use-domains';
import { useCreateDomain } from '@/hooks/use-create-domain';
import { useDeleteDomain } from '@/hooks/use-delete-domain';
import { useVerifyDomain } from '@/hooks/use-verify-domain';
import { errorMessage } from '@/lib/http';
import type { ZoneDomain } from '@/lib/types';

const STATUS_VARIANT: Record<ZoneDomain['sslStatus'], 'secondary' | 'default' | 'destructive'> = {
  pending_dns: 'secondary',
  pending_ssl: 'secondary',
  active: 'default',
  error: 'destructive',
};

export function ZoneDomains({ zoneId }: { zoneId: string }) {
  const { data: domains } = useDomains(zoneId);
  const createDomain = useCreateDomain(zoneId);
  const deleteDomain = useDeleteDomain(zoneId);
  const verifyDomain = useVerifyDomain(zoneId);
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createDomainSchema.safeParse({ domain });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form for errors');
      return;
    }

    try {
      await createDomain.mutateAsync(parsed.data);
      setDomain('');
    } catch (err) {
      setError(errorMessage(err, 'Could not add domain'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom Domains</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-domain">Domain</Label>
            <Input
              id="new-domain"
              placeholder="cdn.your-company.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={createDomain.isPending}>
            {createDomain.isPending ? 'Adding…' : 'Add domain'}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!domains?.length ? (
          <p className="text-sm text-muted-foreground">No custom domains yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CNAME target</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.domain}
                    {d.sslError && <p className="text-xs text-destructive">{d.sslError}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[d.sslStatus]}>{d.sslStatus === 'active' ? 'active' : d.sslStatus}</Badge>
                  </TableCell>
                  <TableCell>{d.cnameTarget}</TableCell>
                  <TableCell className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => verifyDomain.mutate(d.id)}
                      disabled={verifyDomain.isPending}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteDomain.mutate(d.id)}
                      disabled={deleteDomain.isPending}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/dashboard test:unit -- zone-domains`
Expected: PASS.

- [ ] **Step 5: Render it from the zone detail page**

In `apps/dashboard/src/components/zones/zone-detail.tsx`, import and render `ZoneDomains` below the existing card:

```ts
import { ZoneDomains } from './zone-domains';
```

Wrap the existing return in a fragment and add the new component after the `<Card>`:

```tsx
  return (
    <div className="flex flex-col gap-6">
      <Card>
        {/* ... existing CardHeader/CardContent/CardFooter unchanged ... */}
      </Card>
      <ZoneDomains zoneId={zone.id} />
    </div>
  );
```

(Apply this as a targeted edit to the existing file — wrap the current single `<Card>...</Card>` return value in a `<div className="flex flex-col gap-6">` and add `<ZoneDomains zoneId={zone.id} />` as a sibling after it, leaving every other line of `ZoneDetail` unchanged.)

- [ ] **Step 6: Give `zone-detail.test.tsx` a default fetch stub so `ZoneDomains`'s own data fetch never hits the real network**

`ZoneDetail` now also renders `ZoneDomains`, which fires its own `GET /api/zones/zone-1/domains` via `useDomains`. The existing `zone-detail.test.tsx`'s first test doesn't stub `fetch` at all (only the second test does, for the PATCH assertion), so that first test would otherwise let a real, un-mocked `fetch` call fire for the domains request. Add a `beforeEach` that stubs a default empty-list response for every test, which the second test's own `vi.stubGlobal('fetch', fetchMock)` call already overrides for its own assertions:

In `apps/dashboard/src/components/zones/zone-detail.test.tsx`, add a `beforeEach` import and block right after the existing `afterEach`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
```

```ts
describe('ZoneDetail', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
```

(Leave the rest of the file — including the second test's own `vi.stubGlobal('fetch', fetchMock)` call, which simply replaces this default for that test — unchanged.)

- [ ] **Step 7: Run the existing zone-detail test to confirm no regression**

Run: `pnpm --filter @rivocloud/dashboard test:unit -- zone-detail`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/zones/zone-domains.tsx apps/dashboard/src/components/zones/zone-domains.test.tsx apps/dashboard/src/components/zones/zone-detail.tsx apps/dashboard/src/components/zones/zone-detail.test.tsx
git commit -m "feat(dashboard): add Custom Domains section to the zone detail page"
```

---

### Task 12: Documentation — mark Stage 8 done

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`
- Modify: `docs/concepts/custom-domains-and-tls.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update the PRD status line and roadmap table**

In `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md` line 3, extend the status line:

```markdown
**Status:** Draft — Stages 1-8 (Infrastructure Foundation, Identity Service, Go Edge Proxy, CDN Service, Storage Service, Dashboard MVP: auth/zone/storage UI, NATS Invalidation, Custom Domains + TLS) complete, Stages 9–16 not started.
```

In the roadmap table (around line 153), change Stage 8's row:

```markdown
| 8 | Custom Domains + TLS — Traefik Redis provider, DNS verification | 3 | ✅ Done | 4 | [`custom-domains-and-tls.md`](../../concepts/custom-domains-and-tls.md) |
```

- [ ] **Step 2: Remove the "not built yet" caveat from the concept doc**

In `docs/concepts/custom-domains-and-tls.md` line 3, remove the sentence `**This stage has not been built yet** — everything below describes the design in ... not something you can run today.` so the paragraph reads:

```markdown
This document explains **Stage 8** of RivoCloud's Phase 1 build order: letting a customer use their own domain name (e.g. `cdn.their-company.com`) to reach RivoCloud's CDN, with an HTTPS certificate issued and renewed automatically. Everything below describes what was built, matching the design in [`2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Section 5.8, Section 11 block 8) and the [PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) (Section 5.3).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md docs/concepts/custom-domains-and-tls.md
git commit -m "docs: mark Stage 8 done in the PRD"
```
