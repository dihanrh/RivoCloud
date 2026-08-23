# Phase 1 — Stage 5: Storage Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/storage-service` (NestJS) — bucket CRUD, presigned-URL object upload initiation, and a MinIO webhook that completes the upload lifecycle — so a customer can create a bucket, get a direct-to-MinIO upload URL, and see the object's metadata flip from `pending` to `ready` the moment MinIO confirms the bytes landed, with an `object.uploaded` NATS event for anyone else who cares.

**Architecture:** A new control-plane microservice (`apps/storage-service`, NestJS) owns `buckets` and `objects` in PostgreSQL (both tables already exist from Stage 1) and is the only service that talks to MinIO's admin/bucket API. Uploads never pass through this service's process: it hands out a short-lived MinIO presigned PUT URL, the client `PUT`s bytes straight to MinIO, and MinIO calls back a webhook on this service to report the real size/ETag once the object exists — exactly the "control plane generates the URL, data plane moves the bytes" split already used for CDN config in Stage 4. Auth reuses Stage 4's proven pattern verbatim: no shared package, no JWT/API-key logic of its own — every request is verified by calling Identity Service's existing `POST /internal/auth/verify-token` / `POST /internal/auth/verify-api-key` endpoints over HTTP.

**Tech Stack:** NestJS 10, Prisma (`@rivocloud/db`, `buckets`/`objects`/`multipart_uploads` tables already exist from Stage 1), the official `minio` npm package (S3-compatible client + presigned URLs + bucket notification config), `nats` for publishing `object.uploaded`, `class-validator`/`class-transformer` for DTOs, Vitest.

**Spec:**
- [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.4 (Functional Requirements), Section 7 (Roadmap, Stage 5)
- [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 2.4 (Storage Service responsibilities), Section 4.2 (Upload flow), Section 6.3 (Storage tables), Section 7.6 (API), Section 11.5 (5.1/5.2/5.3 development order)
- [`docs/concepts/object-storage-and-uploads.md`](../../concepts/object-storage-and-uploads.md) — the beginner walkthrough this plan implements end-to-end

## Global Constraints

- API routes are versioned `/api/v1/...` (PRD Non-Functional Requirements).
- Every resource is org-scoped; a caller only ever sees buckets/objects belonging to their own `orgId`.
- The Storage Service never proxies file bytes — every upload flows client → MinIO directly via a presigned URL (PRD §5.4, EDD §2.4 "Scaling strategy: MinIO handles all I/O — Storage Service handles only metadata").
- Object versioning and lifecycle-policy *execution* are explicitly Phase 2 scope (EDD §1, PRD §4) — the `version_id`/`is_latest`/`lifecycle_rules` columns already exist and must be populated correctly on every write, but no restore-version API, no version-listing endpoint, and no Scheduler job that reads `lifecycle_rules` belong in this stage.
- This dev machine has a native Windows Postgres install already bound to host port 5432 — Postgres is only reachable via the standalone dev container on port 15432 (see "Local environment setup" below); this is unrelated to any code in this plan.

## Design Decisions (read before starting)

1. **No new shared package, auth is a network call — identical to Stage 4's Decision 1/2.** `apps/storage-service` gets its own `IdentityClient`/`AuthGuard`/`StorageScopeGuard` files, copied from `apps/cdn-service`'s proven, already-reviewed pattern (Stage 4, Tasks 2–3), not imported from either service. Verification calls `apps/identity-service`'s existing internal endpoints over HTTP.
2. **Scope this stage to exactly EDD §11's numbered steps 5.1–5.3** — Bucket CRUD, single-file presigned upload, and the MinIO webhook that completes it. Explicitly **out of scope**, deferred to their own future stages/phases per the EDD and concept doc: multipart upload (no numbered dev-order sub-step covers it, despite `multipart_uploads` already existing in the schema), signed URL generation for downloads (Stage 10, needs Stage 5 to exist first), object version listing/restore (Phase 2), object copy (not in the dev-order list). This mirrors exactly how Stage 4 scoped itself to 4.1/4.2 and deferred domains/cache-rules to Stages 7/8.
3. **MinIO bucket names must be globally unique across the whole MinIO deployment (an S3 naming rule), but `buckets.name` is only unique per-org** (`@@unique([orgId, name])`, Stage 1's schema, deliberately — two orgs can each have a bucket called "photos"). This is the exact same shape of bug Stage 4's final whole-branch review caught with CDN zone hostnames (an org-scoped-unique field leaking into a platform-global namespace). The fix here is the same kind of one: the **physical MinIO bucket name is derived from the bucket row's own UUID** (`rc-{bucket.id}`), never from the user-chosen `name`. Two orgs naming their bucket "photos" get two different, non-colliding physical MinIO buckets; `name` stays purely a per-org display label.
4. **The MinIO webhook target is configured once, server-side, via Docker Compose env vars** (`MINIO_NOTIFY_WEBHOOK_ENABLE_STORAGE`/`_ENDPOINT_STORAGE`/`_AUTH_TOKEN_STORAGE`), exactly mirroring how this repo already configures Redis/NATS/Postgres for local dev — hardcoded dev values directly in `docker-compose.infra.yml`, matching that file's existing all-hardcoded style (no `${VAR}` substitution is used anywhere else in it). Per-bucket, the Storage Service attaches that pre-configured target to each bucket at creation time via the `minio` package's own `setBucketNotification` call — no `mc` CLI is needed in application code, only in one manual local-dev verification step. Verified empirically before writing this plan: a MinIO server started with `MINIO_NOTIFY_WEBHOOK_ENDPOINT_STORAGE` set exposes exactly the ARN `arn:minio:sqs::STORAGE:webhook`, and a real `PUT` against a bucket subscribed to that ARN delivers a real webhook POST to the configured endpoint.
5. **MinIO's webhook payload is the standard S3 event notification JSON** (`{"Records": [{"eventName": ..., "s3": {"bucket": {"name": ...}, "object": {"key": ..., "size": ..., "eTag": ...}}}]}`) — this is a stable, widely-documented format MinIO implements faithfully for S3 compatibility. The object key MinIO reports is URL-encoded (`+` for spaces, percent-encoding for other reserved characters) — Task 7 decodes it defensively.
6. **Object deletion is "soft-delete metadata immediately, best-effort physical MinIO removal inline"** — per the concept doc ("the metadata says deleted but the bytes haven't been physically removed yet" is an accepted, documented window). This stage does not build a background worker/Scheduler (none exists yet); the physical `removeObject` call happens in the same request, but its failure is caught and logged rather than surfaced, since the metadata row (already marked `deleted`) is the source of truth the rest of the system reads.
7. **RBAC mirrors Stage 4's exactly, using the scopes that already exist** in `apps/identity-service/src/organizations/roles.ts`'s `API_KEY_SCOPES` (`storage:read`, `storage:write`, `storage:delete`) and `scopesAllowedForRole` (developer role/key: read+write+delete; viewer: read only) — duplicated as literals in `apps/storage-service`, not imported, per Decision 1.
8. **No Redis dependency.** Storage Service needs Postgres (metadata) and NATS (the `object.uploaded` event) but never touches Redis — `@rivocloud/config`'s `baseEnvSchema` still requires a `REDIS_URL` value to be present in the environment for `validateEnv` to pass (same as every other service), but this app never injects a Redis client or imports `ioredis`.

## Local environment setup (do this before Task 1)

MinIO needs the webhook target defined before any bucket-creation test can call `setBucketNotification` successfully. Add this to the `minio` service block in `infrastructure/compose/docker-compose.infra.yml`, immediately after its existing `environment:` entries:

```yaml
      MINIO_NOTIFY_WEBHOOK_ENABLE_STORAGE: "on"
      MINIO_NOTIFY_WEBHOOK_ENDPOINT_STORAGE: "http://host.docker.internal:3002/internal/storage/minio-webhook"
      MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_STORAGE: "dev_minio_webhook_token_change_me"
```

Then restart the container so it picks up the new env vars: `docker compose -f infrastructure/compose/docker-compose.infra.yml up -d --force-recreate minio`. Confirm it took effect by checking the logs for the ARN line: `docker compose -f infrastructure/compose/docker-compose.infra.yml logs minio | grep "SQS ARNs"` should print `SQS ARNs: arn:minio:sqs::STORAGE:webhook`. This is a real repo file change — commit it as the first step of Task 1, not a throwaway local tweak.

## File Structure

```
apps/storage-service/
  package.json, tsconfig.json, .swcrc, vitest.config.ts, vitest.integration.config.ts
  src/
    main.ts, app.module.ts, env.ts, env.module.ts, app-env.token.ts
    prisma/prisma.module.ts          # copied verbatim from cdn-service/identity-service
    events/events.service.ts         # copied verbatim
    events/events.module.ts          # copied verbatim
    minio/minio.module.ts            # new: MinIO client provider
    health/health.controller.ts
    auth/
      identity-client.ts             # copied from cdn-service, port/env adjusted
      identity-client.provider.ts
      identity-client.test.ts
      auth-context.decorator.ts
      auth-guard.ts
      auth-guard.test.ts
      storage-scope.guard.ts         # cdn-service's zone-scope.guard.ts, renamed + storage: scopes
      storage-scope.guard.test.ts
      auth.module.ts
    buckets/
      bucket-name.util.ts            # physicalBucketName(bucketId)
      buckets.service.ts
      buckets.service.integration.test.ts
      buckets.controller.ts
      buckets.controller.integration.test.ts
      buckets.module.ts
      dto/create-bucket.dto.ts, dto/update-bucket.dto.ts
    objects/
      object-key.util.ts             # splitKeyAndVersion(rawMinioKey)
      objects.service.ts
      objects.service.integration.test.ts
      objects.controller.ts
      objects.controller.integration.test.ts
      objects.module.ts
      dto/initiate-upload.dto.ts, dto/list-objects.dto.ts
      minio-webhook.controller.ts
      minio-webhook.controller.integration.test.ts
      minio-webhook-auth.guard.ts
      minio-webhook-auth.guard.test.ts
```

---

### Task 1: Scaffold `apps/storage-service` + MinIO webhook target infra

**Files:**
- Modify: `infrastructure/compose/docker-compose.infra.yml` (add the 3 webhook env vars to `minio`'s service block)
- Create: `apps/storage-service/package.json`, `tsconfig.json`, `.swcrc`, `vitest.config.ts`, `vitest.integration.config.ts`
- Create: `apps/storage-service/src/env.ts`, `env.module.ts`, `app-env.token.ts`, `main.ts`, `app.module.ts`
- Create: `apps/storage-service/src/prisma/prisma.module.ts`, `src/events/events.service.ts`, `src/events/events.module.ts`
- Create: `apps/storage-service/src/minio/minio.module.ts`
- Create: `apps/storage-service/src/health/health.controller.ts`
- Test: `apps/storage-service/src/health/health.controller.integration.test.ts`

**Interfaces:**
- Consumes: `@rivocloud/db`, `@rivocloud/config`.
- Produces: `AppEnv` (with `MINIO_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_WEBHOOK_AUTH_TOKEN`, `IDENTITY_SERVICE_URL`, `INTERNAL_API_SECRET`, `PORT` default `3002`), `APP_ENV`/`PRISMA`/`MINIO` DI tokens, `EventsService`, a booting NestJS app with `GET /api/v1/health`.

- [ ] **Step 1: Add the MinIO webhook env vars to `infrastructure/compose/docker-compose.infra.yml`**

Find the `minio:` service block:
```yaml
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: rivocloud
      MINIO_ROOT_PASSWORD: rivocloud_dev_password
```
Change the `environment:` block to:
```yaml
    environment:
      MINIO_ROOT_USER: rivocloud
      MINIO_ROOT_PASSWORD: rivocloud_dev_password
      MINIO_NOTIFY_WEBHOOK_ENABLE_STORAGE: "on"
      MINIO_NOTIFY_WEBHOOK_ENDPOINT_STORAGE: "http://host.docker.internal:3002/internal/storage/minio-webhook"
      MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_STORAGE: "dev_minio_webhook_token_change_me"
```

- [ ] **Step 2: Restart MinIO and confirm the webhook target is live**

```bash
docker compose -f infrastructure/compose/docker-compose.infra.yml up -d --force-recreate minio
docker compose -f infrastructure/compose/docker-compose.infra.yml logs minio | grep "SQS ARNs"
```
Expected output contains: `SQS ARNs: arn:minio:sqs::STORAGE:webhook`

- [ ] **Step 3: Create `apps/storage-service/package.json`**

```json
{
  "name": "@rivocloud/storage-service",
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
    "minio": "^8.0.7",
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

- [ ] **Step 4: Create `tsconfig.json`, `.swcrc`, `vitest.config.ts`, `vitest.integration.config.ts`**

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

`.swcrc`:
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

- [ ] **Step 5: Create env handling — `src/app-env.token.ts`, `src/env.ts`, `src/env.module.ts`**

`src/app-env.token.ts`:
```typescript
export const APP_ENV = 'APP_ENV';
```

`src/env.ts`:
```typescript
import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@rivocloud/config';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3002),
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_API_SECRET: z.string().min(16),
  MINIO_URL: z.string().url().default('http://localhost:9000'),
  MINIO_ROOT_USER: z.string().min(1).default('rivocloud'),
  MINIO_ROOT_PASSWORD: z.string().min(1),
  MINIO_WEBHOOK_AUTH_TOKEN: z.string().min(16),
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

- [ ] **Step 6: Create `src/prisma/prisma.module.ts` and `src/events/events.service.ts` + `events.module.ts` (copied verbatim from `apps/cdn-service`)**

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

- [ ] **Step 7: Create `src/minio/minio.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const MINIO = 'MINIO';

@Global()
@Module({
  providers: [
    {
      provide: MINIO,
      useFactory: (env: AppEnv) => {
        const url = new URL(env.MINIO_URL);
        return new MinioClient({
          endPoint: url.hostname,
          port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
          useSSL: url.protocol === 'https:',
          accessKey: env.MINIO_ROOT_USER,
          secretKey: env.MINIO_ROOT_PASSWORD,
        });
      },
      inject: [APP_ENV],
    },
  ],
  exports: [MINIO],
})
export class MinioModule {}
```

- [ ] **Step 8: Write the failing test for the health endpoint — `src/health/health.controller.integration.test.ts`**

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

- [ ] **Step 9: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service install && pnpm --filter @rivocloud/storage-service run test:integration` (needs `DATABASE_URL`/`REDIS_URL`/`NATS_URL`/`INTERNAL_API_SECRET`/`MINIO_URL`/`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_WEBHOOK_AUTH_TOKEN` in the environment).
Expected: FAIL — `app.module.js` does not exist yet.

- [ ] **Step 10: Create `src/health/health.controller.ts`, `src/app.module.ts`, `src/main.ts`**

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
import { EventsModule } from './events/events.module.js';
import { MinioModule } from './minio/minio.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [EnvModule, PrismaModule, EventsModule, MinioModule],
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
  console.log(`storage-service listening on :${env.PORT}`);
}

bootstrap();
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS.

- [ ] **Step 12: Update the pnpm lockfile and confirm the whole monorepo still lints/typechecks**

```bash
pnpm install
pnpm turbo lint typecheck --filter=@rivocloud/storage-service
```

- [ ] **Step 13: Commit**

```bash
git add infrastructure/compose/docker-compose.infra.yml apps/storage-service pnpm-lock.yaml
git commit -m "feat: scaffold apps/storage-service and configure the MinIO webhook target (Stage 5.0)"
```

---

### Task 2: Auth — `IdentityClient` + `AuthGuard`

**Files:**
- Create: `apps/storage-service/src/auth/identity-client.ts`, `identity-client.provider.ts`
- Create: `apps/storage-service/src/auth/auth-context.decorator.ts`, `auth-guard.ts`
- Create: `apps/storage-service/src/auth/auth.module.ts`
- Test: `apps/storage-service/src/auth/identity-client.test.ts`, `auth-guard.test.ts`

**Interfaces:**
- Consumes: `APP_ENV` for `IDENTITY_SERVICE_URL`/`INTERNAL_API_SECRET`.
- Produces: `CombinedAuthContext` (`{ type: 'jwt' | 'api_key'; userId: string | null; orgId: string | null; role: string | null; apiKeyId?: string; permissions?: string[] }`), `AuthCtx()` decorator, `IdentityClient`, `AuthGuard`.

This task is a direct, byte-for-byte port of Stage 4's already-reviewed-clean `apps/cdn-service/src/auth/identity-client.ts`, `auth-guard.ts`, `auth-context.decorator.ts`, `identity-client.provider.ts` — only the import paths change (same relative structure), nothing else. Read those four files first; the code below is identical to them.

- [ ] **Step 1: Write the failing test for `IdentityClient` — `src/auth/identity-client.test.ts`**

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
            res.end(JSON.stringify({ userId: 'u1', orgId: 'o1', permissions: ['storage:read'] }));
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
    expect(identity).toEqual({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, permissions: ['storage:read'] });
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

Run: `pnpm --filter @rivocloud/storage-service run test:unit`
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

interface IdentityResponseBody {
  userId?: string | null;
  orgId?: string | null;
  role?: string | null;
  permissions?: string[];
}

@Injectable()
export class IdentityClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async verifyToken(token: string): Promise<CombinedAuthContext> {
    const body = await this.post('/internal/auth/verify-token', { token }, 'Invalid or expired token');
    return { type: 'jwt', userId: body.userId ?? null, orgId: body.orgId ?? null, role: body.role ?? null };
  }

  async verifyApiKey(apiKey: string): Promise<CombinedAuthContext> {
    const body = await this.post('/internal/auth/verify-api-key', { apiKey }, 'Invalid API key');
    return { type: 'api_key', userId: body.userId ?? null, orgId: body.orgId ?? null, role: null, permissions: body.permissions };
  }

  private async post(path: string, payload: unknown, failureMessage: string): Promise<IdentityResponseBody> {
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
    return (await response.json()) as IdentityResponseBody;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:unit`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `AuthGuard` — `src/auth/auth-guard.test.ts`**

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth-guard.js';
import type { IdentityClient } from './identity-client.js';

function contextWith(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; auth?: unknown } = { headers };
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
    const auth = { type: 'api_key' as const, userId: null, orgId: 'o1', role: null, permissions: ['storage:read'] };
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

Run: `pnpm --filter @rivocloud/storage-service run test:unit`
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
import { IdentityClient } from './identity-client.js';
import { AuthGuard } from './auth-guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard],
  exports: [IdentityClient, AuthGuard],
})
export class AuthModule {}
```

Note: `AuthModule` exports `IdentityClient` (not just `AuthGuard`) from the start — Stage 4's Task 5 discovered mid-implementation that this export is required for NestJS to resolve `AuthGuard`'s constructor dependency when the guard is applied via `@UseGuards()` in a *different* module than `AuthModule` (which is exactly how Task 5 of this plan uses it, on `BucketsController`).

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:unit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/storage-service/src/auth
git commit -m "feat: verify JWTs and API keys against identity-service's internal endpoints"
```

---

### Task 3: RBAC — `StorageScopeGuard` + `RequireStorageScope`

**Files:**
- Create: `apps/storage-service/src/auth/storage-scope.guard.ts`
- Test: `apps/storage-service/src/auth/storage-scope.guard.test.ts`
- Modify: `apps/storage-service/src/auth/auth.module.ts` (register + export `StorageScopeGuard`)

**Interfaces:**
- Consumes: `CombinedAuthContext` (Task 2).
- Produces: `StorageAction = 'read' | 'write' | 'delete'`, `RequireStorageScope(action)` method decorator, `StorageScopeGuard`.

- [ ] **Step 1: Write the failing test — `src/auth/storage-scope.guard.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { StorageScopeGuard } from './storage-scope.guard.js';
import type { CombinedAuthContext } from './auth-context.decorator.js';

function contextWith(auth: CombinedAuthContext, action: string | undefined) {
  const reflector = { get: () => action } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('StorageScopeGuard', () => {
  it('allows any request when the handler has no @RequireStorageScope', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, undefined);
    expect(new StorageScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows a developer JWT to write', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'developer' };
    const { context, reflector } = contextWith(auth, 'write');
    expect(new StorageScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects a viewer JWT trying to write', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'write');
    expect(() => new StorageScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows any JWT role to read', () => {
    const auth: CombinedAuthContext = { type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' };
    const { context, reflector } = contextWith(auth, 'read');
    expect(new StorageScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows an API key with the storage:read scope to read', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['storage:read'] };
    const { context, reflector } = contextWith(auth, 'read');
    expect(new StorageScopeGuard(reflector).canActivate(context)).toBe(true);
  });

  it('rejects an API key missing the storage:delete scope', () => {
    const auth: CombinedAuthContext = { type: 'api_key', userId: null, orgId: 'o1', role: null, permissions: ['storage:read'] };
    const { context, reflector } = contextWith(auth, 'delete');
    expect(() => new StorageScopeGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:unit`
Expected: FAIL — `storage-scope.guard.js` does not exist.

- [ ] **Step 3: Implement `src/auth/storage-scope.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CombinedAuthContext } from './auth-context.decorator.js';

export type StorageAction = 'read' | 'write' | 'delete';
export const STORAGE_SCOPE_KEY = 'storageScope';
export const RequireStorageScope = (action: StorageAction) => SetMetadata(STORAGE_SCOPE_KEY, action);

// Mirrors apps/identity-service/src/organizations/roles.ts's API_KEY_SCOPES /
// scopesAllowedForRole. Duplicated rather than imported across the service
// boundary (Design Decision 1/7) — keep these two in sync by hand until a
// third consumer justifies a shared package.
const ROLES_BY_ACTION: Record<StorageAction, string[]> = {
  read: ['owner', 'admin', 'developer', 'viewer'],
  write: ['owner', 'admin', 'developer'],
  delete: ['owner', 'admin', 'developer'],
};

@Injectable()
export class StorageScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const action = this.reflector.get<StorageAction | undefined>(STORAGE_SCOPE_KEY, context.getHandler());
    if (!action) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const auth: CombinedAuthContext = request.auth;

    if (auth.type === 'api_key') {
      const required = `storage:${action}`;
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

Run: `pnpm --filter @rivocloud/storage-service run test:unit`
Expected: PASS.

- [ ] **Step 5: Register `StorageScopeGuard` in `src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { identityClientProvider } from './identity-client.provider.js';
import { IdentityClient } from './identity-client.js';
import { AuthGuard } from './auth-guard.js';
import { StorageScopeGuard } from './storage-scope.guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard, StorageScopeGuard],
  exports: [IdentityClient, AuthGuard, StorageScopeGuard],
})
export class AuthModule {}
```

- [ ] **Step 6: Commit**

```bash
git add apps/storage-service/src/auth
git commit -m "feat: gate storage endpoints by org role (JWT) or scope (API key)"
```

---

### Task 4: Bucket CRUD service (Postgres + MinIO)

**Files:**
- Create: `apps/storage-service/src/buckets/bucket-name.util.ts`, `buckets.service.ts`
- Test: `apps/storage-service/src/buckets/buckets.service.integration.test.ts`

**Interfaces:**
- Consumes: `PRISMA`, `MINIO` tokens (Task 1); `Bucket` type from `@rivocloud/db`.
- Produces: `physicalBucketName(bucketId): string`; `BucketsService` with `create(orgId, dto)`, `list(orgId, skip, take)`, `getForOrg(orgId, bucketId)`, `update(orgId, bucketId, dto)`, `remove(orgId, bucketId)` — all org-scoped, `remove` throws `ConflictException` if the bucket still has any non-deleted objects.

- [ ] **Step 1: Write the failing test — `src/buckets/buckets.service.integration.test.ts`**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { prisma } from '@rivocloud/db';
import { Client as MinioClient } from 'minio';
import { BucketsService } from './buckets.service.js';
import { physicalBucketName } from './bucket-name.util.js';

const minio = new MinioClient({
  endPoint: '127.0.0.1',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER ?? 'rivocloud',
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'rivocloud_dev_password',
});

async function seedOrg() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Bucket Owner' } });
  return prisma.organization.create({ data: { name: 'Bucket Org', slug: `bucket-org-${randomUUID()}`, ownerId: user.id } });
}

describe('BucketsService', () => {
  const service = new BucketsService(prisma, minio);

  beforeEach(async () => {
    await prisma.storageObject.deleteMany();
    await prisma.bucket.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a bucket in Postgres and a matching physical bucket in MinIO', async () => {
    const org = await seedOrg();
    const bucket = await service.create(org.id, { name: 'My Photos' });

    expect(bucket.name).toBe('My Photos');
    expect(bucket.region).toBe('eu-central');
    expect(bucket.public).toBe(false);

    const exists = await minio.bucketExists(physicalBucketName(bucket.id));
    expect(exists).toBe(true);
  });

  it('allows the same name to be reused in a different org (no global uniqueness on name)', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const bucketA = await service.create(orgA.id, { name: 'Shared Name' });
    const bucketB = await service.create(orgB.id, { name: 'Shared Name' });

    expect(bucketA.id).not.toBe(bucketB.id);
    expect(await minio.bucketExists(physicalBucketName(bucketA.id))).toBe(true);
    expect(await minio.bucketExists(physicalBucketName(bucketB.id))).toBe(true);
  });

  it('lists only the calling org buckets', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await service.create(orgA.id, { name: 'A1' });
    await service.create(orgB.id, { name: 'B1' });

    const page = await service.list(orgA.id, 0, 50);
    expect(page.buckets).toHaveLength(1);
    expect(page.buckets[0].name).toBe('A1');
  });

  it('rejects getForOrg/update/remove on a bucket belonging to a different org', async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const bucket = await service.create(orgA.id, { name: 'A1' });

    await expect(service.getForOrg(orgB.id, bucket.id)).rejects.toThrow(NotFoundException);
    await expect(service.update(orgB.id, bucket.id, { public: true })).rejects.toThrow(NotFoundException);
    await expect(service.remove(orgB.id, bucket.id)).rejects.toThrow(NotFoundException);
  });

  it('updates only the fields provided', async () => {
    const org = await seedOrg();
    const bucket = await service.create(org.id, { name: 'A1' });
    const updated = await service.update(org.id, bucket.id, { public: true });
    expect(updated.public).toBe(true);
    expect(updated.name).toBe('A1');
  });

  it('removes an empty bucket from both Postgres and MinIO', async () => {
    const org = await seedOrg();
    const bucket = await service.create(org.id, { name: 'A1' });
    await service.remove(org.id, bucket.id);

    await expect(service.getForOrg(org.id, bucket.id)).rejects.toThrow(NotFoundException);
    expect(await minio.bucketExists(physicalBucketName(bucket.id))).toBe(false);
  });

  it('refuses to remove a bucket that still has objects', async () => {
    const org = await seedOrg();
    const bucket = await service.create(org.id, { name: 'A1' });
    await prisma.storageObject.create({
      data: {
        bucketId: bucket.id,
        key: 'still-here.txt',
        storagePath: `${physicalBucketName(bucket.id)}/still-here.txt/v1`,
      },
    });

    await expect(service.remove(org.id, bucket.id)).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: FAIL — `buckets.service.js` does not exist.

- [ ] **Step 3: Implement `src/buckets/bucket-name.util.ts` and `buckets.service.ts`**

`src/buckets/bucket-name.util.ts`:
```typescript
// MinIO/S3 bucket names must be globally unique across the whole
// deployment, but buckets.name is only unique per-org (@@unique([orgId,
// name])) — the same shape of bug Stage 4's final review caught with CDN
// zone hostnames. Deriving the physical name from the row's own UUID
// sidesteps it entirely: two orgs can each name their bucket "photos" and
// never collide in MinIO, since the byte-level storage is addressed by ID,
// never by the user-chosen name.
export const PHYSICAL_BUCKET_PREFIX = 'rc-';

export function physicalBucketName(bucketId: string): string {
  return `${PHYSICAL_BUCKET_PREFIX}${bucketId}`;
}
```

Unlike Stage 4's zones (which strip `signingSecret` before returning a response), `Bucket` has no secret-like column — every field is safe to return as-is, so this task has no separate response-mapping file; `buckets.service.ts` returns Prisma rows directly.

`src/buckets/buckets.service.ts`:
```typescript
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient, Bucket } from '@rivocloud/db';
import type { Client as MinioClient } from 'minio';
import { NotificationConfig, QueueConfig, ObjectCreatedPut } from 'minio';
import { PRISMA } from '../prisma/prisma.module.js';
import { MINIO } from '../minio/minio.module.js';
import { physicalBucketName } from './bucket-name.util.js';
import type { CreateBucketDto } from './dto/create-bucket.dto.js';
import type { UpdateBucketDto } from './dto/update-bucket.dto.js';

const MINIO_WEBHOOK_ARN = 'arn:minio:sqs::STORAGE:webhook';

@Injectable()
export class BucketsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(MINIO) private readonly minio: MinioClient,
  ) {}

  async create(orgId: string, dto: CreateBucketDto) {
    const bucket = await this.db.bucket.create({
      data: { orgId, name: dto.name, region: dto.region ?? 'eu-central', public: dto.public ?? false },
    });
    const physicalName = physicalBucketName(bucket.id);
    await this.minio.makeBucket(physicalName, bucket.region);
    const notification = new NotificationConfig();
    const queueConfig = new QueueConfig(MINIO_WEBHOOK_ARN);
    queueConfig.addEvent(ObjectCreatedPut);
    notification.add(queueConfig);
    await this.minio.setBucketNotification(physicalName, notification);
    return bucket;
  }

  async list(orgId: string, skip: number, take: number) {
    const [buckets, total] = await Promise.all([
      this.db.bucket.findMany({ where: { orgId }, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.bucket.count({ where: { orgId } }),
    ]);
    return { buckets, total };
  }

  async getForOrg(orgId: string, bucketId: string) {
    return this.findOwned(orgId, bucketId);
  }

  async update(orgId: string, bucketId: string, dto: UpdateBucketDto) {
    await this.findOwned(orgId, bucketId);
    return this.db.bucket.update({
      where: { id: bucketId },
      data: {
        ...(dto.public !== undefined && { public: dto.public }),
        ...(dto.versioningEnabled !== undefined && { versioningEnabled: dto.versioningEnabled }),
        ...(dto.lifecycleRules !== undefined && { lifecycleRules: dto.lifecycleRules }),
      },
    });
  }

  async remove(orgId: string, bucketId: string): Promise<void> {
    const bucket = await this.findOwned(orgId, bucketId);
    const remaining = await this.db.storageObject.count({ where: { bucketId, status: { not: 'deleted' } } });
    if (remaining > 0) {
      throw new ConflictException('Bucket is not empty — delete its objects first');
    }
    await this.minio.removeBucket(physicalBucketName(bucket.id));
    await this.db.bucket.delete({ where: { id: bucketId } });
  }

  private async findOwned(orgId: string, bucketId: string): Promise<Bucket> {
    const bucket = await this.db.bucket.findUnique({ where: { id: bucketId } });
    if (!bucket || bucket.orgId !== orgId) {
      throw new NotFoundException('Bucket not found');
    }
    return bucket;
  }
}
```

This references `./dto/create-bucket.dto.js` and `./dto/update-bucket.dto.js`, which Task 5 creates with full validation — add minimal placeholders now so this task's test can run standalone:

`src/buckets/dto/create-bucket.dto.ts`:
```typescript
export class CreateBucketDto {
  name!: string;
  region?: string;
  public?: boolean;
}
```

`src/buckets/dto/update-bucket.dto.ts`:
```typescript
export class UpdateBucketDto {
  public?: boolean;
  versioningEnabled?: boolean;
  lifecycleRules?: unknown;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS. (This test needs the local environment setup at the top of this plan already applied — `setBucketNotification` will fail with an unrecognized-ARN error otherwise.)

- [ ] **Step 5: Commit**

```bash
git add apps/storage-service/src/buckets
git commit -m "feat: bucket CRUD service backed by Postgres and MinIO"
```

---

### Task 5: Bucket CRUD controller + DTOs

**Files:**
- Modify: `apps/storage-service/src/buckets/dto/create-bucket.dto.ts`, `dto/update-bucket.dto.ts` (add validation)
- Create: `apps/storage-service/src/buckets/buckets.controller.ts`, `buckets.module.ts`
- Modify: `apps/storage-service/src/app.module.ts` (import `BucketsModule`)
- Test: `apps/storage-service/src/buckets/buckets.controller.integration.test.ts`

**Interfaces:**
- Consumes: `AuthGuard`, `StorageScopeGuard`, `RequireStorageScope`, `AuthCtx`, `CombinedAuthContext` (Tasks 2–3); `BucketsService` (Task 4).
- Produces: `POST /api/v1/buckets`, `GET /api/v1/buckets`, `GET /api/v1/buckets/:bucketId`, `PATCH /api/v1/buckets/:bucketId`, `DELETE /api/v1/buckets/:bucketId` per EDD §7.6.

- [ ] **Step 1: Add validation to the DTOs**

`src/buckets/dto/create-bucket.dto.ts`:
```typescript
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBucketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(63)
  name!: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsBoolean()
  public?: boolean;
}
```

`src/buckets/dto/update-bucket.dto.ts`:
```typescript
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateBucketDto {
  @IsOptional()
  @IsBoolean()
  public?: boolean;

  @IsOptional()
  @IsBoolean()
  versioningEnabled?: boolean;

  @IsOptional()
  lifecycleRules?: unknown;
}
```

- [ ] **Step 2: Write the failing test — `src/buckets/buckets.controller.integration.test.ts`**

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

describe('BucketsController', () => {
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
    await prisma.storageObject.deleteMany();
    await prisma.bucket.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedOrgAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Bucket Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    return org;
  }

  it('rejects a request with no credential', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/buckets');
    expect(response.status).toBe(401);
  });

  it('creates a bucket for the caller org', async () => {
    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Bucket' });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('My Bucket');
  });

  it('rejects a viewer trying to create a bucket', async () => {
    await seedOrgAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'My Bucket' });
    expect(response.status).toBe(403);
  });

  it('does not leak a bucket across organizations', async () => {
    await seedOrgAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'A1' });

    await seedOrgAndAuth('owner');
    const response = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(404);
  });

  it('updates and deletes an empty bucket', async () => {
    await seedOrgAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'A1' });

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/buckets/${created.body.id}`)
      .set('Authorization', 'Bearer whatever')
      .send({ public: true });
    expect(updated.status).toBe(200);
    expect(updated.body.public).toBe(true);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/buckets/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);

    const getAfterDelete = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(getAfterDelete.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: FAIL — `buckets.controller.js` does not exist.

- [ ] **Step 4: Implement `src/buckets/buckets.controller.ts` and `src/buckets/buckets.module.ts`**

`src/buckets/buckets.controller.ts`:
```typescript
import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireStorageScope, StorageScopeGuard } from '../auth/storage-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { BucketsService } from './buckets.service.js';
import { CreateBucketDto } from './dto/create-bucket.dto.js';
import { UpdateBucketDto } from './dto/update-bucket.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/buckets')
@UseGuards(AuthGuard, StorageScopeGuard)
export class BucketsController {
  constructor(private readonly buckets: BucketsService) {}

  @Post()
  @RequireStorageScope('write')
  create(@AuthCtx() auth: CombinedAuthContext, @Body() dto: CreateBucketDto) {
    return this.buckets.create(requireOrgId(auth), dto);
  }

  @Get()
  @RequireStorageScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.buckets.list(requireOrgId(auth), Number(skip) || 0, Number(take) || 50);
  }

  @Get(':bucketId')
  @RequireStorageScope('read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string) {
    return this.buckets.getForOrg(requireOrgId(auth), bucketId);
  }

  @Patch(':bucketId')
  @RequireStorageScope('write')
  update(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Body() dto: UpdateBucketDto) {
    return this.buckets.update(requireOrgId(auth), bucketId, dto);
  }

  @Delete(':bucketId')
  @RequireStorageScope('delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string) {
    await this.buckets.remove(requireOrgId(auth), bucketId);
    return { success: true };
  }
}
```

`src/buckets/buckets.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { BucketsController } from './buckets.controller.js';
import { BucketsService } from './buckets.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [BucketsController],
  providers: [BucketsService],
  exports: [BucketsService],
})
export class BucketsModule {}
```

`BucketsService` is exported because Task 8's `ObjectsModule` needs to check bucket ownership without duplicating `BucketsService`'s `findOwned` logic — Task 8 imports `BucketsModule` and injects `BucketsService` directly.

- [ ] **Step 5: Import `BucketsModule` in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { MinioModule } from './minio/minio.module.js';
import { HealthController } from './health/health.controller.js';
import { BucketsModule } from './buckets/buckets.module.js';

@Module({
  imports: [EnvModule, PrismaModule, EventsModule, MinioModule, BucketsModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/storage-service/src
git commit -m "feat: expose bucket CRUD over /api/v1/buckets, gated by role/scope"
```

---

### Task 6: Object upload initiation (presigned PUT)

**Files:**
- Create: `apps/storage-service/src/objects/objects.service.ts` (upload-initiation half only — `initiateUpload`, `list`, `getForOrg`; `markUploaded`/`remove` come in Tasks 7–8)
- Create: `apps/storage-service/src/objects/dto/initiate-upload.dto.ts`, `dto/list-objects.dto.ts`
- Create: `apps/storage-service/src/objects/objects.controller.ts`, `objects.module.ts`
- Modify: `apps/storage-service/src/app.module.ts` (import `ObjectsModule`)
- Test: `apps/storage-service/src/objects/objects.service.integration.test.ts`, `objects.controller.integration.test.ts`

**Interfaces:**
- Consumes: `PRISMA`, `MINIO` tokens; `BucketsService` (Task 4/5, for ownership checks); `physicalBucketName` (Task 4); `AuthGuard`/`StorageScopeGuard`/`RequireStorageScope`/`AuthCtx` (Tasks 2–3).
- Produces: `ObjectsService.initiateUpload(orgId, bucketId, dto): Promise<{ objectId, uploadUrl }>`, `.list(orgId, bucketId, opts)`, `.getForOrg(orgId, bucketId, key)`; `POST /api/v1/buckets/:bucketId/objects/upload`, `GET /api/v1/buckets/:bucketId/objects`, `GET /api/v1/buckets/:bucketId/objects/:key`.

- [ ] **Step 1: Write the failing test — `src/objects/objects.service.integration.test.ts`**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma } from '@rivocloud/db';
import { Client as MinioClient } from 'minio';
import { BucketsService } from '../buckets/buckets.service.js';
import { ObjectsService } from './objects.service.js';

const minio = new MinioClient({
  endPoint: '127.0.0.1',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER ?? 'rivocloud',
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'rivocloud_dev_password',
});

async function seedOrgAndBucket(buckets: BucketsService, name = 'Test Bucket') {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  const bucket = await buckets.create(org.id, { name });
  return { org, bucket };
}

describe('ObjectsService', () => {
  const buckets = new BucketsService(prisma, minio);
  const service = new ObjectsService(prisma, minio, buckets);

  beforeEach(async () => {
    await prisma.storageObject.deleteMany();
    await prisma.bucket.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('inserts a pending object row and returns a presigned PUT URL', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    const result = await service.initiateUpload(org.id, bucket.id, { key: 'hello.txt', contentType: 'text/plain' });

    expect(result.uploadUrl).toMatch(/^http/);
    const object = await prisma.storageObject.findUnique({ where: { id: result.objectId } });
    expect(object).not.toBeNull();
    expect(object!.status).toBe('pending');
    expect(object!.key).toBe('hello.txt');
    expect(object!.contentType).toBe('text/plain');
  });

  it('rejects initiating an upload into a bucket belonging to a different org', async () => {
    const { bucket } = await seedOrgAndBucket(buckets);
    const otherUser = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Other' } });
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Org', slug: `other-org-${randomUUID()}`, ownerId: otherUser.id },
    });

    await expect(
      service.initiateUpload(otherOrg.id, bucket.id, { key: 'hello.txt' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists objects for a bucket, newest first, only latest versions', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'a.txt' });
    await service.initiateUpload(org.id, bucket.id, { key: 'b.txt' });

    const page = await service.list(org.id, bucket.id, { skip: 0, take: 50 });
    expect(page.objects).toHaveLength(2);
    expect(page.objects.every((o) => o.isLatest)).toBe(true);
  });

  it('gets object metadata by key', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'a.txt' });

    const object = await service.getForOrg(org.id, bucket.id, 'a.txt');
    expect(object.key).toBe('a.txt');
    expect(object.status).toBe('pending');
  });

  it('throws NotFoundException getting an unknown key', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await expect(service.getForOrg(org.id, bucket.id, 'missing.txt')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: FAIL — `objects.service.js` does not exist.

- [ ] **Step 3: Implement `src/objects/dto/initiate-upload.dto.ts`, `dto/list-objects.dto.ts`, `objects.service.ts`**

`src/objects/dto/initiate-upload.dto.ts`:
```typescript
export class InitiateUploadDto {
  key!: string;
  contentType?: string;
  size?: number;
}
```

`src/objects/dto/list-objects.dto.ts`:
```typescript
export class ListObjectsDto {
  prefix?: string;
  skip?: number;
  take?: number;
}
```

(Task 8 adds `class-validator` decorators to `InitiateUploadDto` and `class-transformer`'s `@Type` to `ListObjectsDto` — this task only needs their shape.)

`src/objects/objects.service.ts`:
```typescript
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@rivocloud/db';
import type { Client as MinioClient } from 'minio';
import { PRISMA } from '../prisma/prisma.module.js';
import { MINIO } from '../minio/minio.module.js';
import { BucketsService } from '../buckets/buckets.service.js';
import { physicalBucketName } from '../buckets/bucket-name.util.js';
import type { InitiateUploadDto } from './dto/initiate-upload.dto.js';
import type { ListObjectsDto } from './dto/list-objects.dto.js';

const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;

@Injectable()
export class ObjectsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(MINIO) private readonly minio: MinioClient,
    private readonly buckets: BucketsService,
  ) {}

  async initiateUpload(orgId: string, bucketId: string, dto: InitiateUploadDto) {
    await this.buckets.getForOrg(orgId, bucketId);
    const versionId = randomUUID();
    const physicalName = physicalBucketName(bucketId);
    const minioObjectKey = `${dto.key}/${versionId}`;
    const object = await this.db.storageObject.create({
      data: {
        bucketId,
        key: dto.key,
        versionId,
        contentType: dto.contentType ?? 'application/octet-stream',
        size: dto.size !== undefined ? BigInt(dto.size) : null,
        storagePath: `${physicalName}/${minioObjectKey}`,
        status: 'pending',
      },
    });
    const uploadUrl = await this.minio.presignedPutObject(physicalName, minioObjectKey, PRESIGNED_UPLOAD_TTL_SECONDS);
    return { objectId: object.id, uploadUrl };
  }

  async list(orgId: string, bucketId: string, opts: ListObjectsDto) {
    await this.buckets.getForOrg(orgId, bucketId);
    const where = {
      bucketId,
      isLatest: true,
      status: { not: 'deleted' },
      ...(opts.prefix && { key: { startsWith: opts.prefix } }),
    };
    const [objects, total] = await Promise.all([
      this.db.storageObject.findMany({ where, skip: opts.skip ?? 0, take: opts.take ?? 50, orderBy: { createdAt: 'desc' } }),
      this.db.storageObject.count({ where }),
    ]);
    return { objects, total };
  }

  async getForOrg(orgId: string, bucketId: string, key: string) {
    await this.buckets.getForOrg(orgId, bucketId);
    return this.findLatest(bucketId, key);
  }

  private async findLatest(bucketId: string, key: string) {
    const object = await this.db.storageObject.findFirst({ where: { bucketId, key, isLatest: true } });
    if (!object || object.status === 'deleted') {
      throw new NotFoundException('Object not found');
    }
    return object;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS.

- [ ] **Step 5: Write the failing test — `src/objects/objects.controller.integration.test.ts`**

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
    if (!this.nextAuth) throw new Error('not set');
    return this.nextAuth;
  }
  async verifyApiKey(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('not set');
    return this.nextAuth;
  }
}

describe('ObjectsController', () => {
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
    await prisma.storageObject.deleteMany();
    await prisma.bucket.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedOrgBucketAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role: 'owner' };
    const bucketRes = await request(app.getHttpServer())
      .post('/api/v1/buckets')
      .set('Authorization', 'Bearer whatever')
      .send({ name: 'Bucket' });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    return { org, bucketId: bucketRes.body.id };
  }

  it('initiates an upload and returns a presigned URL', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'hello.txt', contentType: 'text/plain' });

    expect(response.status).toBe(201);
    expect(response.body.uploadUrl).toMatch(/^http/);
    expect(typeof response.body.objectId).toBe('string');
  });

  it('rejects a viewer trying to initiate an upload', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'hello.txt' });
    expect(response.status).toBe(403);
  });

  it('lists and gets object metadata', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('owner');
    await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'hello.txt' });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${bucketId}/objects`)
      .set('Authorization', 'Bearer whatever');
    expect(list.status).toBe(200);
    expect(list.body.objects).toHaveLength(1);

    const get = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${bucketId}/objects/hello.txt`)
      .set('Authorization', 'Bearer whatever');
    expect(get.status).toBe(200);
    expect(get.body.status).toBe('pending');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: FAIL — `objects.controller.js` does not exist.

- [ ] **Step 7: Implement `src/objects/objects.controller.ts` and `src/objects/objects.module.ts`**

`src/objects/objects.controller.ts`:
```typescript
import { Body, Controller, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireStorageScope, StorageScopeGuard } from '../auth/storage-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { ObjectsService } from './objects.service.js';
import { InitiateUploadDto } from './dto/initiate-upload.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/buckets/:bucketId/objects')
@UseGuards(AuthGuard, StorageScopeGuard)
export class ObjectsController {
  constructor(private readonly objects: ObjectsService) {}

  @Post('upload')
  @RequireStorageScope('write')
  initiateUpload(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('bucketId') bucketId: string,
    @Body() dto: InitiateUploadDto,
  ) {
    return this.objects.initiateUpload(requireOrgId(auth), bucketId, dto);
  }

  @Get()
  @RequireStorageScope('read')
  list(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('bucketId') bucketId: string,
    @Query('prefix') prefix?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.objects.list(requireOrgId(auth), bucketId, {
      prefix,
      skip: Number(skip) || 0,
      take: Number(take) || 50,
    });
  }

  @Get(':key')
  @RequireStorageScope('read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Param('key') key: string) {
    return this.objects.getForOrg(requireOrgId(auth), bucketId, key);
  }
}
```

Note: NestJS route params don't decode `/` inside a single `:key` segment — for this stage's manual/API testing, a `key` containing slashes (e.g. `assets/hero.jpg`) must be URL-encoded by the caller when hitting `GET`/`DELETE .../objects/:key` (e.g. `assets%2Fhero.jpg`). Express decodes it back to `assets/hero.jpg` before it reaches the controller.

`src/objects/objects.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ObjectsController } from './objects.controller.js';
import { ObjectsService } from './objects.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { BucketsModule } from '../buckets/buckets.module.js';

@Module({
  imports: [AuthModule, BucketsModule],
  controllers: [ObjectsController],
  providers: [ObjectsService],
})
export class ObjectsModule {}
```

- [ ] **Step 8: Import `ObjectsModule` in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { EventsModule } from './events/events.module.js';
import { MinioModule } from './minio/minio.module.js';
import { HealthController } from './health/health.controller.js';
import { BucketsModule } from './buckets/buckets.module.js';
import { ObjectsModule } from './objects/objects.module.js';

@Module({
  imports: [EnvModule, PrismaModule, EventsModule, MinioModule, BucketsModule, ObjectsModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/storage-service/src
git commit -m "feat: initiate presigned uploads and expose object metadata (Stage 5.2)"
```

---

### Task 7: MinIO webhook — complete the upload lifecycle

**Files:**
- Create: `apps/storage-service/src/objects/minio-webhook-auth.guard.ts`, `minio-webhook.controller.ts`
- Create: `apps/storage-service/src/objects/object-key.util.ts`
- Modify: `apps/storage-service/src/objects/objects.service.ts` (add `markUploaded`)
- Modify: `apps/storage-service/src/objects/objects.module.ts` (register the webhook controller)
- Test: `apps/storage-service/src/objects/minio-webhook-auth.guard.test.ts`, `minio-webhook.controller.integration.test.ts`

**Interfaces:**
- Consumes: `EventsService` (Task 1), `objects.service.ts`'s existing Prisma access, `physicalBucketName` (Task 4).
- Produces: `ObjectsService.markUploaded(record)`; `POST /internal/storage/minio-webhook`, guarded by `MinioWebhookAuthGuard`; publishes `object.uploaded` `{ bucketId, key, orgId }` to NATS.

- [ ] **Step 1: Write the failing test for the auth guard — `src/objects/minio-webhook-auth.guard.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { MinioWebhookAuthGuard } from './minio-webhook-auth.guard.js';
import type { AppEnv } from '../env.js';

function contextWith(headers: Record<string, string>) {
  const request = { headers };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const fakeEnv = { MINIO_WEBHOOK_AUTH_TOKEN: 'expected-token' } as AppEnv;

describe('MinioWebhookAuthGuard', () => {
  it('rejects a request with no Authorization header', () => {
    const guard = new MinioWebhookAuthGuard(fakeEnv);
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });

  it('rejects a request with the wrong token', () => {
    const guard = new MinioWebhookAuthGuard(fakeEnv);
    expect(() => guard.canActivate(contextWith({ authorization: 'Bearer wrong-token' }))).toThrow(UnauthorizedException);
  });

  it('accepts a request with the correct bearer token', () => {
    const guard = new MinioWebhookAuthGuard(fakeEnv);
    expect(guard.canActivate(contextWith({ authorization: 'Bearer expected-token' }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:unit`
Expected: FAIL — `minio-webhook-auth.guard.js` does not exist.

- [ ] **Step 3: Implement `src/objects/object-key.util.ts` and `src/objects/minio-webhook-auth.guard.ts`**

`src/objects/object-key.util.ts`:
```typescript
import { PHYSICAL_BUCKET_PREFIX } from '../buckets/bucket-name.util.js';

// The MinIO object key for an upload is "{key}/{versionId}" (objects.service.ts's
// initiateUpload). versionId is always the last path segment and is always a
// UUID with no slashes in it, but key itself can legitimately contain slashes
// (e.g. "assets/hero.jpg") — so split on the LAST "/", not the first.
export function splitKeyAndVersion(rawMinioKey: string): [key: string, versionId: string] {
  const lastSlash = rawMinioKey.lastIndexOf('/');
  return [rawMinioKey.slice(0, lastSlash), rawMinioKey.slice(lastSlash + 1)];
}

// MinIO's webhook reports the object key URL-encoded (spaces as "+", other
// reserved characters percent-encoded) — decode it before use.
export function decodeMinioObjectKey(rawKey: string): string {
  return decodeURIComponent(rawKey.replace(/\+/g, ' '));
}

// The webhook reports the physical bucket name (PHYSICAL_BUCKET_PREFIX +
// bucketId) — strip the prefix to recover the row's own id. Imports the
// same constant physicalBucketName() uses to build it, so the two can never
// drift out of sync.
export function bucketIdFromPhysicalName(physicalName: string): string {
  return physicalName.startsWith(PHYSICAL_BUCKET_PREFIX) ? physicalName.slice(PHYSICAL_BUCKET_PREFIX.length) : physicalName;
}
```

`src/objects/minio-webhook-auth.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Injectable()
export class MinioWebhookAuthGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] as string | undefined;
    if (authHeader !== `Bearer ${this.env.MINIO_WEBHOOK_AUTH_TOKEN}`) {
      throw new UnauthorizedException('Invalid or missing MinIO webhook token');
    }
    return true;
  }
}
```

This is the same shape as `apps/identity-service/src/internal/internal-secret.guard.ts`'s `InternalSecretGuard` — a plain `@Inject(APP_ENV)` constructor Nest can instantiate normally via DI, with no special-casing needed for the unit test above (it just constructs the class directly with a fake `AppEnv` object, the same way `zone-scope.guard.test.ts` constructs guards directly in Stage 4).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:unit`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the webhook endpoint — `src/objects/minio-webhook.controller.integration.test.ts`**

```typescript
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { Client as MinioClient } from 'minio';
import { AppModule } from '../app.module.js';
import { BucketsService } from '../buckets/buckets.service.js';
import { EventsService } from '../events/events.service.js';

const minio = new MinioClient({
  endPoint: '127.0.0.1',
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER ?? 'rivocloud',
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? 'rivocloud_dev_password',
});

const WEBHOOK_TOKEN = process.env.MINIO_WEBHOOK_AUTH_TOKEN ?? 'dev_minio_webhook_token_change_me';

function minioNotificationBody(bucketPhysicalName: string, minioObjectKey: string, size: number, etag: string) {
  return {
    Records: [
      {
        eventName: 's3:ObjectCreated:Put',
        s3: {
          bucket: { name: bucketPhysicalName },
          object: { key: minioObjectKey.replace(/\//g, '%2F'), size, eTag: etag },
        },
      },
    ],
  };
}

describe('MinioWebhookController', () => {
  let app: INestApplication;
  let events: EventsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    events = app.get(EventsService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.storageObject.deleteMany();
    await prisma.bucket.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  it('rejects a webhook call with the wrong auth token', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/storage/minio-webhook')
      .set('Authorization', 'Bearer wrong-token')
      .send({ Records: [] });
    expect(response.status).toBe(401);
  });

  it('marks a pending object ready and publishes object.uploaded', async () => {
    const buckets = app.get(BucketsService);
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    const bucket = await buckets.create(org.id, { name: 'Webhook Bucket' });

    // Seed a pending object row directly (mirrors what initiateUpload does)
    const physicalName = `rc-${bucket.id}`;
    const versionId = 'v1-fake-uuid-0000-0000-000000000000';
    const object = await prisma.storageObject.create({
      data: {
        bucketId: bucket.id,
        key: 'hello.txt',
        versionId,
        storagePath: `${physicalName}/hello.txt/${versionId}`,
        status: 'pending',
      },
    });

    const response = await request(app.getHttpServer())
      .post('/internal/storage/minio-webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
      .send(minioNotificationBody(physicalName, `hello.txt/${versionId}`, 42, 'abc123etag'));

    expect(response.status).toBe(201);

    const updated = await prisma.storageObject.findUnique({ where: { id: object.id } });
    expect(updated!.status).toBe('ready');
    expect(updated!.size).toBe(42n);
    expect(updated!.etag).toBe('abc123etag');

    expect(events.getLastPublished('object.uploaded')).toEqual({ bucketId: bucket.id, key: 'hello.txt', orgId: org.id });
  });

  it('ignores a notification for an object it has no record of', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/storage/minio-webhook')
      .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
      .send(minioNotificationBody('rc-unknown-bucket-id', 'nope.txt/some-version', 1, 'x'));
    expect(response.status).toBe(201);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: FAIL — `minio-webhook.controller.js` does not exist.

- [ ] **Step 7: Add `markUploaded` to `objects.service.ts` and implement `minio-webhook.controller.ts`**

Modify `src/objects/objects.service.ts` — add the `EventsService` dependency and the `markUploaded` method, and the two new imports:

```typescript
import { EventsService } from '../events/events.service.js';
import { bucketIdFromPhysicalName, decodeMinioObjectKey, splitKeyAndVersion } from './object-key.util.js';
```

Change the constructor to:
```typescript
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(MINIO) private readonly minio: MinioClient,
    private readonly buckets: BucketsService,
    private readonly events: EventsService,
  ) {}
```

Add this method to the class:
```typescript
  async markUploaded(record: { s3: { bucket: { name: string }; object: { key: string; size: number; eTag: string } } }): Promise<void> {
    const bucketId = bucketIdFromPhysicalName(record.s3.bucket.name);
    const rawKey = decodeMinioObjectKey(record.s3.object.key);
    const [key, versionId] = splitKeyAndVersion(rawKey);

    const object = await this.db.storageObject.findFirst({ where: { bucketId, key, versionId } });
    if (!object) {
      return; // no matching pending upload — ignore (defensive; shouldn't happen for our own uploads)
    }

    await this.db.storageObject.update({
      where: { id: object.id },
      data: { status: 'ready', size: BigInt(record.s3.object.size), etag: record.s3.object.eTag },
    });

    const bucket = await this.db.bucket.findUnique({ where: { id: bucketId } });
    if (bucket) {
      await this.events.publish('object.uploaded', { bucketId, key, orgId: bucket.orgId });
    }
  }
```

Create `src/objects/minio-webhook.controller.ts`:
```typescript
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { MinioWebhookAuthGuard } from './minio-webhook-auth.guard.js';
import { ObjectsService } from './objects.service.js';

interface MinioNotificationBody {
  Records?: Array<{
    s3: { bucket: { name: string }; object: { key: string; size: number; eTag: string } };
  }>;
}

@Controller('internal/storage')
export class MinioWebhookController {
  constructor(private readonly objects: ObjectsService) {}

  @Post('minio-webhook')
  @UseGuards(MinioWebhookAuthGuard)
  async handleWebhook(@Body() body: MinioNotificationBody) {
    for (const record of body.Records ?? []) {
      await this.objects.markUploaded(record);
    }
    return { received: true };
  }
}
```

`MinioWebhookAuthGuard` needs to be registered as a provider so `@UseGuards(MinioWebhookAuthGuard)` on `MinioWebhookController` (in the same module) resolves it — add it directly to `src/objects/objects.module.ts`'s `providers` array, next step. Because it's a plain `@Inject(APP_ENV)` class (not a custom factory), Nest constructs it the normal way, the same as `AuthGuard`/`StorageScopeGuard` elsewhere in this app.

- [ ] **Step 8: Register the webhook controller and guard in `src/objects/objects.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ObjectsController } from './objects.controller.js';
import { ObjectsService } from './objects.service.js';
import { MinioWebhookController } from './minio-webhook.controller.js';
import { MinioWebhookAuthGuard } from './minio-webhook-auth.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { BucketsModule } from '../buckets/buckets.module.js';

@Module({
  imports: [AuthModule, BucketsModule],
  controllers: [ObjectsController, MinioWebhookController],
  providers: [ObjectsService, MinioWebhookAuthGuard],
})
export class ObjectsModule {}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS. Also re-run Task 6's `objects.service.integration.test.ts` and `objects.controller.integration.test.ts` — `ObjectsService`'s constructor gained a 4th parameter (`EventsService`), and the tests that construct it directly need updating.

- [ ] **Step 10: Update Task 6's tests for the new `ObjectsService` constructor**

In `src/objects/objects.service.integration.test.ts`, add the import `import { EventsService } from '../events/events.service.js';` and change:
```typescript
const service = new ObjectsService(prisma, minio, buckets);
```
to:
```typescript
const events = new EventsService(process.env.NATS_URL ?? 'nats://localhost:4222');
const service = new ObjectsService(prisma, minio, buckets, events);
```

`src/objects/objects.controller.integration.test.ts` boots the real `AppModule` via Nest's DI, so it needs no change — Nest resolves the new constructor parameter automatically.

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS, full suite green.

- [ ] **Step 11: Commit**

```bash
git add apps/storage-service/src
git commit -m "feat: complete the upload lifecycle via MinIO's webhook (Stage 5.3)"
```

---

### Task 8: Object listing validation, delete, and DTO hardening

**Files:**
- Modify: `apps/storage-service/src/objects/dto/initiate-upload.dto.ts`, `dto/list-objects.dto.ts` (add validation)
- Modify: `apps/storage-service/src/objects/objects.service.ts` (add `remove`)
- Modify: `apps/storage-service/src/objects/objects.controller.ts` (add `DELETE`, wire the validated `ListObjectsDto`)
- Test: extend `objects.service.integration.test.ts` and `objects.controller.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–7.
- Produces: `ObjectsService.remove(orgId, bucketId, key): Promise<void>`; `DELETE /api/v1/buckets/:bucketId/objects/:key`.

- [ ] **Step 1: Add validation to the DTOs**

`src/objects/dto/initiate-upload.dto.ts`:
```typescript
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class InitiateUploadDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;
}
```

`src/objects/dto/list-objects.dto.ts`:
```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListObjectsDto {
  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
```

- [ ] **Step 2: Write the failing test — append to `src/objects/objects.service.integration.test.ts`**

```typescript
  it('soft-deletes an object and best-effort removes it from MinIO', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'to-delete.txt' });

    await service.remove(org.id, bucket.id, 'to-delete.txt');

    await expect(service.getForOrg(org.id, bucket.id, 'to-delete.txt')).rejects.toThrow(NotFoundException);
  });

  it('rejects deleting an object belonging to a different org', async () => {
    const { org, bucket } = await seedOrgAndBucket(buckets);
    await service.initiateUpload(org.id, bucket.id, { key: 'mine.txt' });

    const otherUser = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Other' } });
    const otherOrg = await prisma.organization.create({
      data: { name: 'Other Org', slug: `other-org-${randomUUID()}`, ownerId: otherUser.id },
    });

    await expect(service.remove(otherOrg.id, bucket.id, 'mine.txt')).rejects.toThrow(NotFoundException);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: FAIL — `service.remove is not a function`.

- [ ] **Step 4: Add `remove` to `objects.service.ts`**

Add this method to `ObjectsService`, and add `import { Logger } from '@nestjs/common';` plus a `private readonly logger = new Logger(ObjectsService.name);` field:

```typescript
  async remove(orgId: string, bucketId: string, key: string): Promise<void> {
    await this.buckets.getForOrg(orgId, bucketId);
    const object = await this.findLatest(bucketId, key);

    await this.db.storageObject.update({ where: { id: object.id }, data: { status: 'deleted' } });

    try {
      const minioObjectKey = `${object.key}/${object.versionId}`;
      await this.minio.removeObject(physicalBucketName(bucketId), minioObjectKey);
    } catch (error) {
      // Best-effort: the metadata row (already marked deleted, above) is the
      // source of truth every other read in this service checks. A failed
      // physical removal here just means bytes linger in MinIO a bit longer
      // — documented, accepted window (Design Decision 6).
      this.logger.warn(`failed to remove MinIO object for ${bucketId}/${key}: ${error}`);
    }
  }
```

Add the import `import { physicalBucketName } from '../buckets/bucket-name.util.js';` if it isn't already present from Task 4's `initiateUpload`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS.

- [ ] **Step 6: Write the failing controller test — append to `src/objects/objects.controller.integration.test.ts`**

```typescript
  it('deletes an object', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('admin');
    await request(app.getHttpServer())
      .post(`/api/v1/buckets/${bucketId}/objects/upload`)
      .set('Authorization', 'Bearer whatever')
      .send({ key: 'gone.txt' });

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/buckets/${bucketId}/objects/gone.txt`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);

    const getAfterDelete = await request(app.getHttpServer())
      .get(`/api/v1/buckets/${bucketId}/objects/gone.txt`)
      .set('Authorization', 'Bearer whatever');
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects a developer with only storage:read from deleting', async () => {
    const { bucketId } = await seedOrgBucketAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .delete(`/api/v1/buckets/${bucketId}/objects/whatever.txt`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(403);
  });
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: FAIL — no `DELETE` route registered (404 instead of the expected 200/403).

- [ ] **Step 8: Add the `DELETE` route and switch to the validated `ListObjectsDto` in `objects.controller.ts`**

Replace the `list` method's raw query params with a validated DTO, and add `remove`:

```typescript
import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { RequireStorageScope, StorageScopeGuard } from '../auth/storage-scope.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { ObjectsService } from './objects.service.js';
import { InitiateUploadDto } from './dto/initiate-upload.dto.js';
import { ListObjectsDto } from './dto/list-objects.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/buckets/:bucketId/objects')
@UseGuards(AuthGuard, StorageScopeGuard)
export class ObjectsController {
  constructor(private readonly objects: ObjectsService) {}

  @Post('upload')
  @RequireStorageScope('write')
  initiateUpload(
    @AuthCtx() auth: CombinedAuthContext,
    @Param('bucketId') bucketId: string,
    @Body() dto: InitiateUploadDto,
  ) {
    return this.objects.initiateUpload(requireOrgId(auth), bucketId, dto);
  }

  @Get()
  @RequireStorageScope('read')
  list(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Query() query: ListObjectsDto) {
    return this.objects.list(requireOrgId(auth), bucketId, query);
  }

  @Get(':key')
  @RequireStorageScope('read')
  get(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Param('key') key: string) {
    return this.objects.getForOrg(requireOrgId(auth), bucketId, key);
  }

  @Delete(':key')
  @RequireStorageScope('delete')
  async remove(@AuthCtx() auth: CombinedAuthContext, @Param('bucketId') bucketId: string, @Param('key') key: string) {
    await this.objects.remove(requireOrgId(auth), bucketId, key);
    return { success: true };
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @rivocloud/storage-service run test:integration`
Expected: PASS, full suite green.

- [ ] **Step 10: Commit**

```bash
git add apps/storage-service/src
git commit -m "feat: soft-delete objects and validate upload/list DTOs"
```

---

### Task 9: PRD update and manual end-to-end verification

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: a PRD marked with Stage 5 done, and a confirmed live walkthrough of the concept doc's upload lifecycle — create a bucket, initiate an upload, really `PUT` bytes to the presigned URL, watch MinIO's real webhook flip the object to `ready` with the real size/ETag, confirm the `object.uploaded` NATS event fires.

No CI changes are needed: `apps/storage-service` is picked up automatically by `pnpm turbo lint typecheck test:unit test:integration` (workspace glob `apps/*`), and `.github/workflows/ci.yml`'s `test-integration` job already exports `DATABASE_URL`/`REDIS_URL`/`NATS_URL`/`INTERNAL_API_SECRET`. Add `MINIO_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, and `MINIO_WEBHOOK_AUTH_TOKEN` to the `test-integration` job's `env:` block in `.github/workflows/ci.yml` (matching the existing style), and add a `minio` service container alongside the existing `postgres`/`redis`/`nats` ones:

```yaml
      minio:
        image: minio/minio:latest
        env:
          MINIO_ROOT_USER: rivocloud
          MINIO_ROOT_PASSWORD: rivocloud_dev_password
          MINIO_NOTIFY_WEBHOOK_ENABLE_STORAGE: "on"
          MINIO_NOTIFY_WEBHOOK_ENDPOINT_STORAGE: "http://localhost:3002/internal/storage/minio-webhook"
          MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_STORAGE: "ci_minio_webhook_token_placeholder"
        ports:
          - 9000:9000
        options: >-
          --health-cmd "curl -f http://localhost:9000/minio/health/live || exit 1"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
        entrypoint: sh
        command: -c "minio server /data"
```
And add to the job's `env:` block:
```yaml
      MINIO_URL: http://localhost:9000
      MINIO_ROOT_USER: rivocloud
      MINIO_ROOT_PASSWORD: rivocloud_dev_password
      MINIO_WEBHOOK_AUTH_TOKEN: ci_minio_webhook_token_placeholder
```
Note CI's webhook endpoint uses `localhost`, not `host.docker.internal` — GitHub Actions service containers and the job's own runner share the same network namespace (unlike this dev machine's Docker Desktop VM boundary), so `localhost:3002` from inside the `minio` service container reaches the `storage-service` test process running directly on the runner. If this specific detail turns out to be wrong when CI actually runs (service-container networking specifics can surprise you), that's a CI-only follow-up — it doesn't affect any of Tasks 1–8's local verification.

- [ ] **Step 1: Update the PRD to mark Stage 5 done**

In `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`, change the roadmap table row:
```
| 5 | Storage Service — bucket CRUD, presigned upload, MinIO webhook | 3 | Not started | 2 | [`object-storage-and-uploads.md`](../../concepts/object-storage-and-uploads.md) |
```
to:
```
| 5 | Storage Service — bucket CRUD, presigned upload, MinIO webhook | 3 | ✅ Done | 2 | [`object-storage-and-uploads.md`](../../concepts/object-storage-and-uploads.md) |
```

And change the **Status** line at the top of the document:
```
**Status:** Draft — Stages 1-4 (Infrastructure Foundation, Identity Service, Go Edge Proxy, CDN Service) complete, Stages 5–16 not started.
```
to:
```
**Status:** Draft — Stages 1-5 (Infrastructure Foundation, Identity Service, Go Edge Proxy, CDN Service, Storage Service) complete, Stages 6–16 not started.
```

- [ ] **Step 2: Manual end-to-end verification — the concept doc's upload lifecycle, for real**

Start infra and the service:
```bash
docker compose -f infrastructure/compose/docker-compose.infra.yml up -d postgres redis nats minio
pnpm --filter @rivocloud/db exec prisma migrate deploy
INTERNAL_API_SECRET=dev_internal_secret_local_only \
MINIO_ROOT_USER=rivocloud MINIO_ROOT_PASSWORD=rivocloud_dev_password \
MINIO_WEBHOOK_AUTH_TOKEN=dev_minio_webhook_token_change_me \
pnpm --filter @rivocloud/identity-service dev &
INTERNAL_API_SECRET=dev_internal_secret_local_only \
MINIO_ROOT_USER=rivocloud MINIO_ROOT_PASSWORD=rivocloud_dev_password \
MINIO_WEBHOOK_AUTH_TOKEN=dev_minio_webhook_token_change_me \
pnpm --filter @rivocloud/storage-service dev &
sleep 3
```

Register a user, create an org, and capture the access token (same flow as Stage 4's E2E verification):
```bash
curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"storage-e2e@example.com","password":"hunter22222","name":"Storage E2E"}' >/dev/null

LOGIN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"storage-e2e@example.com","password":"hunter22222"}')
ACCESS_TOKEN=$(echo "$LOGIN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

ORG=$(curl -s -X POST http://localhost:3001/api/v1/orgs \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Storage E2E Org"}')
ORG_ACCESS_TOKEN=$(echo "$ORG" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
```

Create a bucket and initiate an upload:
```bash
BUCKET=$(curl -s -X POST http://localhost:3002/api/v1/buckets \
  -H "Authorization: Bearer $ORG_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Bucket"}')
echo "$BUCKET"
BUCKET_ID=$(echo "$BUCKET" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

UPLOAD=$(curl -s -X POST "http://localhost:3002/api/v1/buckets/$BUCKET_ID/objects/upload" \
  -H "Authorization: Bearer $ORG_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"hello.txt","contentType":"text/plain"}')
echo "$UPLOAD"
UPLOAD_URL=$(echo "$UPLOAD" | node -pe 'JSON.parse(require("fs").readFileSync(0)).uploadUrl')
OBJECT_ID=$(echo "$UPLOAD" | node -pe 'JSON.parse(require("fs").readFileSync(0)).objectId')
```
Expected: `BUCKET` has no `signingSecret`-equivalent leak (this table has none, but confirm the shape looks like `{id, orgId, name, region, ...}`); `UPLOAD` has a real `uploadUrl` starting with `http://` and pointing at MinIO's port 9000.

Actually `PUT` the file bytes directly to MinIO, bypassing the Storage Service entirely:
```bash
echo "hello from the real upload" > /tmp/e2e-upload.txt
curl -s -X PUT "$UPLOAD_URL" --data-binary @/tmp/e2e-upload.txt -H 'Content-Type: text/plain'
sleep 1
```

Confirm the object flipped from `pending` to `ready` with the real size/ETag MinIO reported — this is the webhook firing for real, not a simulated payload:
```bash
curl -s "http://localhost:3002/api/v1/buckets/$BUCKET_ID/objects/hello.txt" \
  -H "Authorization: Bearer $ORG_ACCESS_TOKEN"
```
Expected: `{"status":"ready","size":"28", ...}` (or whatever `/tmp/e2e-upload.txt`'s real byte count is) with a non-null `etag` — proving MinIO's real webhook, not this plan's simulated test payload, drove the transition.

Delete the object and the (now-empty) bucket:
```bash
curl -s -X DELETE "http://localhost:3002/api/v1/buckets/$BUCKET_ID/objects/hello.txt" \
  -H "Authorization: Bearer $ORG_ACCESS_TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3002/api/v1/buckets/$BUCKET_ID/objects/hello.txt" \
  -H "Authorization: Bearer $ORG_ACCESS_TOKEN"
curl -s -X DELETE "http://localhost:3002/api/v1/buckets/$BUCKET_ID" \
  -H "Authorization: Bearer $ORG_ACCESS_TOKEN"
```
Expected: the object GET after delete returns `404`; the bucket delete returns `{"success":true}` (it's empty now, since the object is soft-deleted and excluded from the `remaining` count Task 4's `remove()` checks).

Stop the background processes afterward (`kill %1 %2` or close the terminal).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md .github/workflows/ci.yml
git commit -m "docs: mark Stage 5 (Storage Service) done in the PRD, wire MinIO into CI"
```
