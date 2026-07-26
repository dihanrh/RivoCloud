# Phase 1 — Stage 1: Infrastructure Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the RivoCloud monorepo foundation — pnpm/Turborepo workspace tooling, the local infrastructure Docker Compose stack, the PostgreSQL schema (via Prisma), and a working CI pipeline — so every later Phase 1 stage (Identity Service, Edge Proxy, CDN Service, ...) has somewhere to live and a database to talk to.

**Architecture:** This is Stage 1 of the 16-stage Phase 1 build order documented in `docs/phase1-development-flow.md` and `docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md` (Section 10/11). It produces no application services yet — only the monorepo scaffold (`apps/`, `packages/`), the shared `packages/db` (Prisma) and `packages/config` (env validation) libraries, the infra-only Docker Compose file, and `.github/workflows/ci.yml`. Application services (Identity, CDN, Edge Proxy, etc.) are later stages and are out of scope here — this plan only creates the directories/tooling they'll need.

**Tech Stack:** pnpm workspaces + Turborepo (task orchestration), TypeScript 5, Prisma 5 (PostgreSQL ORM), Zod (env validation), Vitest (test runner), ESLint 9 flat config, Docker Compose (Postgres 16, Redis 7, MinIO, ClickHouse 23, NATS 2 with JetStream, Prometheus, Grafana, Loki), GitHub Actions.

## Global Constraints

- Node.js >= 22 (matches installed `v22.13.1`).
- Package manager: pnpm 9.11.0 (matches installed `pnpm -v`). Pin via root `package.json` `"packageManager"` field.
- Every API is versioned from day one (`/api/v1/...`) — not yet relevant to this stage (no APIs built yet), but schema/tooling must not preclude it later.
- Every mutating table that needs an audit trail already has one in the schema below (`audit_logs`) — do not add ad-hoc logging tables later.
- All binary/file data goes to MinIO, never PostgreSQL `bytea` columns (per master architecture §7.4 Mistake 1) — the `objects` table here stores only metadata.
- Secrets never committed to git: `.env` files are git-ignored; `.env.example` is committed with placeholder values only.
- Go is **not** installed in this environment (`go: command not found`) and no Go code exists yet (Edge Proxy is Stage 3) — do **not** create `go.work` in this plan; it would reference nonexistent module directories. Create it when Stage 3 adds `apps/edge-proxy`.
- Do not build `apps/*` service directories in this stage — only `packages/*` (shared libraries) and root tooling. Stages 2+ own the app directories.

---

### Task 1: Monorepo scaffolding & tooling

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.nvmrc`
- Create: `.env.example`

**Interfaces:**
- Produces: root `pnpm turbo <task>` scripts (`lint`, `typecheck`, `test:unit`, `test:integration`, `build`, `dev`) that every later package/app plugs into via matching `package.json` scripts. Later tasks (2-5) rely on `turbo.json` already defining these task names.
- Produces: `tsconfig.base.json` that every `packages/*`/`apps/*` package extends via `"extends": "../../tsconfig.base.json"`.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "rivocloud",
  "private": true,
  "version": "0.0.1",
  "engines": {
    "node": ">=22"
  },
  "packageManager": "pnpm@9.11.0",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test:unit": "turbo test:unit",
    "test:integration": "turbo test:integration"
  },
  "devDependencies": {
    "@eslint/js": "^9.11.0",
    "eslint": "^9.11.0",
    "turbo": "^2.1.3",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.7.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "outputs": []
    },
    "test:unit": {
      "outputs": []
    },
    "test:integration": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 5: Create `eslint.config.js`**

```javascript
// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/generated/**', '**/.turbo/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
.turbo/
*.log
.env
.env.*.local
.DS_Store
packages/db/generated/
packages/db/src/generated/
coverage/
```

- [ ] **Step 7: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 8: Create `.nvmrc`**

```
22
```

- [ ] **Step 9: Create `.env.example`**

```bash
# Postgres
DATABASE_URL=postgresql://rivocloud:rivocloud_dev_password@localhost:5432/rivocloud

# Redis
REDIS_URL=redis://localhost:6379

# NATS
NATS_URL=nats://localhost:4222

# MinIO
MINIO_URL=http://localhost:9000
MINIO_ROOT_USER=rivocloud
MINIO_ROOT_PASSWORD=rivocloud_dev_password

# ClickHouse
CLICKHOUSE_URL=http://localhost:8123
```

- [ ] **Step 10: Install root dependencies**

Run: `pnpm install`
Expected: pnpm creates `pnpm-lock.yaml` and `node_modules/`, no errors (no workspace packages exist yet, so it only installs root devDependencies).

- [ ] **Step 11: Verify turbo is wired up (no packages yet, should no-op cleanly)**

Run: `pnpm turbo lint typecheck`
Expected: `No tasks were executed as part of this run.` (or similar) — this confirms turbo runs without error before any packages exist. Not a failure.

- [ ] **Step 12: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.js .gitignore .editorconfig .nvmrc .env.example pnpm-lock.yaml
git commit -m "chore: scaffold pnpm/turborepo monorepo tooling"
```

---

### Task 2: Infrastructure Docker Compose stack

**Files:**
- Create: `infrastructure/compose/docker-compose.infra.yml`
- Create: `infrastructure/compose/prometheus.yml`
- Create: `scripts/dev.sh`

**Interfaces:**
- Produces: a running Postgres on `localhost:5432` (db `rivocloud`, user/pass `rivocloud`/`rivocloud_dev_password`), Redis on `localhost:6379`, MinIO on `localhost:9000`/console `9001`, ClickHouse HTTP on `localhost:8123` (native protocol remapped to host `9009` to avoid colliding with MinIO's `9000`), NATS on `localhost:4222` (monitoring `8222`, JetStream enabled), Prometheus on `localhost:9090`, Grafana on `localhost:3002`, Loki on `localhost:3100`.
- Consumes: nothing from Task 1 besides the repo root existing.
- Task 4 (`packages/db`) consumes the Postgres connection this task starts.

- [ ] **Step 1: Create `infrastructure/compose/prometheus.yml`**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]
```

- [ ] **Step 2: Create `infrastructure/compose/docker-compose.infra.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: rivocloud
      POSTGRES_USER: rivocloud
      POSTGRES_PASSWORD: rivocloud_dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rivocloud"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [rivocloud]

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [rivocloud]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: rivocloud
      MINIO_ROOT_PASSWORD: rivocloud_dev_password
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [rivocloud]

  clickhouse:
    image: clickhouse/clickhouse-server:23
    ports:
      - "8123:8123"
      - "9009:9000"
    volumes:
      - clickhouse_data:/var/lib/clickhouse
    networks: [rivocloud]

  nats:
    image: nats:2-alpine
    command: "-js -m 8222"
    ports:
      - "4222:4222"
      - "8222:8222"
    networks: [rivocloud]

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
    networks: [rivocloud]

  grafana:
    image: grafana/grafana:latest
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
    ports:
      - "3002:3000"
    networks: [rivocloud]

  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    networks: [rivocloud]

volumes:
  postgres_data:
  redis_data:
  minio_data:
  clickhouse_data:

networks:
  rivocloud:
    driver: bridge
```

- [ ] **Step 3: Create `scripts/dev.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose -f infrastructure/compose/docker-compose.infra.yml up -d

echo ""
echo "Infra services starting. Check status with:"
echo "  docker compose -f infrastructure/compose/docker-compose.infra.yml ps"
echo ""
echo "Postgres  -> localhost:5432 (db: rivocloud, user: rivocloud)"
echo "Redis     -> localhost:6379"
echo "MinIO     -> http://localhost:9000 (console: http://localhost:9001)"
echo "ClickHouse-> http://localhost:8123"
echo "NATS      -> localhost:4222 (monitor: http://localhost:8222)"
echo "Prometheus-> http://localhost:9090"
echo "Grafana   -> http://localhost:3002"
echo "Loki      -> http://localhost:3100"
```

- [ ] **Step 4: Make the script executable and run it**

Run: `chmod +x scripts/dev.sh && ./scripts/dev.sh`
Expected: Docker pulls images (first run only) and starts 8 containers; script prints the service URL summary.

- [ ] **Step 5: Verify all services are healthy**

Run: `docker compose -f infrastructure/compose/docker-compose.infra.yml ps`
Expected: `postgres`, `redis`, and `minio` show `healthy` in the STATUS column (they have healthchecks); `clickhouse`, `nats`, `prometheus`, `grafana`, `loki` show `Up` (no healthcheck configured for these).

- [ ] **Step 6: Verify Postgres accepts connections**

Run: `docker exec -it $(docker compose -f infrastructure/compose/docker-compose.infra.yml ps -q postgres) psql -U rivocloud -d rivocloud -c "SELECT 1;"`
Expected: returns a `1` row (`?column? | 1`).

- [ ] **Step 7: Commit**

```bash
git add infrastructure/compose/docker-compose.infra.yml infrastructure/compose/prometheus.yml scripts/dev.sh
git commit -m "feat: add local infrastructure Docker Compose stack"
```

---

### Task 3: `packages/config` — environment validation

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/vitest.config.ts`
- Create: `packages/config/src/env.ts`
- Test: `packages/config/src/env.test.ts`
- Create: `packages/config/src/index.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json` (Task 1, Step 4), root `turbo.json` task names `lint`/`typecheck`/`test:unit`/`test:integration` (Task 1, Step 3).
- Produces: `validateEnv<T extends ZodTypeAny>(schema: T, env?: NodeJS.ProcessEnv): z.infer<T>` and `baseEnvSchema: ZodObject<{ NODE_ENV, DATABASE_URL, REDIS_URL, NATS_URL }>`, exported from `@rivocloud/config`. Later NestJS services (Stage 2+) import these to validate their own env at startup, extending `baseEnvSchema` with `.extend({...})`.

- [ ] **Step 1: Create `packages/config/package.json`**

```json
{
  "name": "@rivocloud/config",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run",
    "test:integration": "echo \"no integration tests in @rivocloud/config\""
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `packages/config/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/config/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write the failing test — `packages/config/src/env.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateEnv } from './env';

describe('validateEnv', () => {
  it('parses valid environment variables according to the schema', () => {
    const schema = z.object({ FOO: z.string() });
    const result = validateEnv(schema, { FOO: 'bar' } as NodeJS.ProcessEnv);
    expect(result.FOO).toBe('bar');
  });

  it('throws a descriptive error naming the missing key when validation fails', () => {
    const schema = z.object({ FOO: z.string() });
    expect(() => validateEnv(schema, {} as NodeJS.ProcessEnv)).toThrow(/FOO/);
  });

  it('applies defaults declared on the schema', () => {
    const schema = z.object({ NODE_ENV: z.enum(['development', 'test', 'production']).default('development') });
    const result = validateEnv(schema, {} as NodeJS.ProcessEnv);
    expect(result.NODE_ENV).toBe('development');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @rivocloud/config install && pnpm --filter @rivocloud/config test:unit`
Expected: FAIL — `Cannot find module './env'` (file doesn't exist yet).

- [ ] **Step 6: Write minimal implementation — `packages/config/src/env.ts`**

```typescript
import { z } from 'zod';

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  NATS_URL: z.string().url(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function validateEnv<T extends z.ZodTypeAny>(
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 7: Create `packages/config/src/index.ts`**

```typescript
export * from './env';
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @rivocloud/config test:unit`
Expected: PASS — 3 tests passed.

- [ ] **Step 9: Run typecheck and lint**

Run: `pnpm --filter @rivocloud/config typecheck && pnpm --filter @rivocloud/config lint`
Expected: both exit 0, no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/config
git commit -m "feat: add @rivocloud/config package with zod env validation"
```

---

### Task 4: `packages/db` — Prisma schema and client

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.integration.config.ts`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/index.ts`
- Test: `packages/db/src/client.integration.test.ts`

**Interfaces:**
- Consumes: running Postgres from Task 2 at `DATABASE_URL=postgresql://rivocloud:rivocloud_dev_password@localhost:5432/rivocloud`; `tsconfig.base.json` from Task 1.
- Produces: `prisma: PrismaClient` singleton and all generated Prisma model types (`User`, `Organization`, `OrganizationMember`, `ApiKey`, `PullZone`, `ZoneDomain`, `CacheRule`, `CacheInvalidation`, `Bucket`, `StorageObject`, `MultipartUpload`, `BillingAccount`, `UsageRecord`, `Invoice`, `AuditLog`, `JobRun`, `OAuthAccount`, `EmailVerificationToken`, `Project`) exported from `@rivocloud/db`. Stage 2 (Identity Service) and later stages import `prisma` from this package rather than creating their own `PrismaClient`.

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@rivocloud/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:unit": "echo \"no unit tests in @rivocloud/db\"",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "generate": "prisma generate",
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "^5.20.0"
  },
  "devDependencies": {
    "prisma": "^5.20.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/db/vitest.integration.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 15000,
  },
});
```

- [ ] **Step 4: Create `packages/db/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Identity / Auth ─────────────────────────────────────────────

model User {
  id            String   @id @default(uuid()) @db.Uuid
  email         String   @unique
  passwordHash  String?  @map("password_hash")
  name          String
  avatarUrl     String?  @map("avatar_url")
  emailVerified Boolean  @default(false) @map("email_verified")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  oauthAccounts           OAuthAccount[]
  ownedOrganizations      Organization[]           @relation("OrgOwner")
  organizationMemberships OrganizationMember[]     @relation("Member")
  invitedMembers          OrganizationMember[]     @relation("InvitedBy")
  apiKeys                 ApiKey[]
  emailVerificationTokens EmailVerificationToken[]
  cacheInvalidations      CacheInvalidation[]
  auditLogs               AuditLog[]

  @@map("users")
}

model OAuthAccount {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  provider     String
  providerId   String   @map("provider_id")
  accessToken  String?  @map("access_token")
  refreshToken String?  @map("refresh_token")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerId])
  @@map("oauth_accounts")
}

model Organization {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  slug      String   @unique
  plan      String   @default("free")
  ownerId   String   @map("owner_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  owner          User                 @relation("OrgOwner", fields: [ownerId], references: [id])
  members        OrganizationMember[]
  apiKeys        ApiKey[]
  projects       Project[]
  pullZones      PullZone[]
  buckets        Bucket[]
  billingAccount BillingAccount?
  usageRecords   UsageRecord[]
  invoices       Invoice[]
  auditLogs      AuditLog[]

  @@map("organizations")
}

model OrganizationMember {
  id        String    @id @default(uuid()) @db.Uuid
  orgId     String    @map("org_id") @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  role      String    @default("developer")
  invitedBy String?   @map("invited_by") @db.Uuid
  joinedAt  DateTime? @map("joined_at") @db.Timestamptz
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user         User         @relation("Member", fields: [userId], references: [id], onDelete: Cascade)
  inviter      User?        @relation("InvitedBy", fields: [invitedBy], references: [id])

  @@unique([orgId, userId])
  @@map("organization_members")
}

model ApiKey {
  id          String    @id @default(uuid()) @db.Uuid
  orgId       String    @map("org_id") @db.Uuid
  userId      String?   @map("user_id") @db.Uuid
  name        String
  keyHash     String    @unique @map("key_hash")
  keyPrefix   String    @map("key_prefix")
  permissions Json      @default("[]")
  lastUsedAt  DateTime? @map("last_used_at") @db.Timestamptz
  expiresAt   DateTime? @map("expires_at") @db.Timestamptz
  revokedAt   DateTime? @map("revoked_at") @db.Timestamptz
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user         User?        @relation(fields: [userId], references: [id])
  auditLogs    AuditLog[]

  @@map("api_keys")
}

model EmailVerificationToken {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  tokenHash String   @unique @map("token_hash")
  expiresAt DateTime @map("expires_at") @db.Timestamptz
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("email_verification_tokens")
}

// ── CDN ──────────────────────────────────────────────────────────

model Project {
  id        String   @id @default(uuid()) @db.Uuid
  orgId     String   @map("org_id") @db.Uuid
  name      String
  slug      String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  pullZones    PullZone[]
  buckets      Bucket[]

  @@unique([orgId, slug])
  @@map("projects")
}

model PullZone {
  id             String   @id @default(uuid()) @db.Uuid
  orgId          String   @map("org_id") @db.Uuid
  projectId      String?  @map("project_id") @db.Uuid
  name           String
  slug           String
  originUrl      String   @map("origin_url")
  originProtocol String   @default("https") @map("origin_protocol")
  cacheTtl       Int      @default(3600) @map("cache_ttl")
  browserTtl     Int      @default(0) @map("browser_ttl")
  enabled        Boolean  @default(true)
  signingSecret  String?  @map("signing_secret")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  organization       Organization        @relation(fields: [orgId], references: [id], onDelete: Cascade)
  project            Project?            @relation(fields: [projectId], references: [id], onDelete: SetNull)
  domains            ZoneDomain[]
  cacheRules         CacheRule[]
  cacheInvalidations CacheInvalidation[]

  @@unique([orgId, slug])
  @@map("pull_zones")
}

model ZoneDomain {
  id            String    @id @default(uuid()) @db.Uuid
  zoneId        String    @map("zone_id") @db.Uuid
  domain        String    @unique
  sslStatus     String    @default("pending_dns") @map("ssl_status")
  sslError      String?   @map("ssl_error")
  certExpiresAt DateTime? @map("cert_expires_at") @db.Timestamptz
  isPrimary     Boolean   @default(false) @map("is_primary")
  verifiedAt    DateTime? @map("verified_at") @db.Timestamptz
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz

  zone PullZone @relation(fields: [zoneId], references: [id], onDelete: Cascade)

  @@map("zone_domains")
}

model CacheRule {
  id             String   @id @default(uuid()) @db.Uuid
  zoneId         String   @map("zone_id") @db.Uuid
  pattern        String
  patternType    String   @default("glob") @map("pattern_type")
  action         String   @default("cache")
  edgeTtl        Int?     @map("edge_ttl")
  browserTtl     Int?     @map("browser_ttl")
  queryString    String   @default("strip_all") @map("query_string")
  queryWhitelist String[] @map("query_whitelist")
  priority       Int      @default(0)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz

  zone PullZone @relation(fields: [zoneId], references: [id], onDelete: Cascade)

  @@map("cache_rules")
}

model CacheInvalidation {
  id            String    @id @default(uuid()) @db.Uuid
  zoneId        String    @map("zone_id") @db.Uuid
  createdBy     String?   @map("created_by") @db.Uuid
  patterns      String[]
  tags          String[]
  status        String    @default("pending")
  edgesNotified Int?      @map("edges_notified")
  keysPurged    Int?      @map("keys_purged")
  completedAt   DateTime? @map("completed_at") @db.Timestamptz
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz

  zone    PullZone @relation(fields: [zoneId], references: [id], onDelete: Cascade)
  creator User?    @relation(fields: [createdBy], references: [id])

  @@map("cache_invalidations")
}

// ── Storage ──────────────────────────────────────────────────────

model Bucket {
  id                String   @id @default(uuid()) @db.Uuid
  orgId             String   @map("org_id") @db.Uuid
  projectId         String?  @map("project_id") @db.Uuid
  name              String
  region            String   @default("eu-central")
  versioningEnabled Boolean  @default(false) @map("versioning_enabled")
  public            Boolean  @default(false)
  lifecycleRules    Json     @default("[]") @map("lifecycle_rules")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz

  organization     Organization      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  project          Project?          @relation(fields: [projectId], references: [id], onDelete: SetNull)
  objects          StorageObject[]
  multipartUploads MultipartUpload[]

  @@unique([orgId, name])
  @@map("buckets")
}

model StorageObject {
  id          String    @id @default(uuid()) @db.Uuid
  bucketId    String    @map("bucket_id") @db.Uuid
  key         String
  versionId   String    @default(uuid()) @map("version_id") @db.Uuid
  isLatest    Boolean   @default(true) @map("is_latest")
  size        BigInt?
  contentType String    @default("application/octet-stream") @map("content_type")
  etag        String?
  storagePath String    @map("storage_path")
  metadata    Json      @default("{}")
  status      String    @default("pending")
  expiresAt   DateTime? @map("expires_at") @db.Timestamptz
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  bucket Bucket @relation(fields: [bucketId], references: [id], onDelete: Cascade)

  @@unique([bucketId, key, versionId])
  @@index([bucketId, key], map: "idx_objects_bucket_key_latest")
  @@index([expiresAt], map: "idx_objects_expires")
  @@map("objects")
}

model MultipartUpload {
  id            String   @id @default(uuid()) @db.Uuid
  bucketId      String   @map("bucket_id") @db.Uuid
  objectKey     String   @map("object_key")
  minioUploadId String   @map("minio_upload_id")
  parts         Json     @default("[]")
  expiresAt     DateTime @map("expires_at") @db.Timestamptz
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz

  bucket Bucket @relation(fields: [bucketId], references: [id], onDelete: Cascade)

  @@map("multipart_uploads")
}

// ── Billing ──────────────────────────────────────────────────────

model BillingAccount {
  id               String    @id @default(uuid()) @db.Uuid
  orgId            String    @unique @map("org_id") @db.Uuid
  stripeCustomerId String?   @unique @map("stripe_customer_id")
  stripeSubId      String?   @unique @map("stripe_sub_id")
  plan             String    @default("free")
  status           String    @default("active")
  trialEndsAt      DateTime? @map("trial_ends_at") @db.Timestamptz
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt        DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  organization Organization @relation(fields: [orgId], references: [id])

  @@map("billing_accounts")
}

model UsageRecord {
  id             String   @id @default(uuid()) @db.Uuid
  orgId          String   @map("org_id") @db.Uuid
  periodStart    DateTime @map("period_start") @db.Date
  periodEnd      DateTime @map("period_end") @db.Date
  bandwidthBytes BigInt   @default(0) @map("bandwidth_bytes")
  requests       BigInt   @default(0)
  storageBytes   BigInt   @default(0) @map("storage_bytes")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  organization Organization @relation(fields: [orgId], references: [id])

  @@unique([orgId, periodStart])
  @@map("usage_records")
}

model Invoice {
  id              String    @id @default(uuid()) @db.Uuid
  orgId           String    @map("org_id") @db.Uuid
  stripeInvoiceId String?   @unique @map("stripe_invoice_id")
  amountCents     Int       @map("amount_cents")
  currency        String    @default("usd")
  status          String
  periodStart     DateTime  @map("period_start") @db.Date
  periodEnd       DateTime  @map("period_end") @db.Date
  paidAt          DateTime? @map("paid_at") @db.Timestamptz
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz

  organization Organization @relation(fields: [orgId], references: [id])

  @@map("invoices")
}

// ── Audit + System ───────────────────────────────────────────────

model AuditLog {
  id           BigInt   @id @default(autoincrement())
  orgId        String?  @map("org_id") @db.Uuid
  userId       String?  @map("user_id") @db.Uuid
  apiKeyId     String?  @map("api_key_id") @db.Uuid
  action       String
  resourceType String?  @map("resource_type")
  resourceId   String?  @map("resource_id")
  ipAddress    String?  @map("ip_address") @db.Inet
  userAgent    String?  @map("user_agent")
  requestId    String?  @map("request_id")
  metadata     Json     @default("{}")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz

  organization Organization? @relation(fields: [orgId], references: [id], onDelete: SetNull)
  user         User?         @relation(fields: [userId], references: [id], onDelete: SetNull)
  apiKey       ApiKey?       @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)

  @@index([orgId, createdAt], map: "idx_audit_logs_org_created")
  @@map("audit_logs")
}

model JobRun {
  id          String    @id @default(uuid()) @db.Uuid
  jobName     String    @map("job_name")
  status      String    @default("running")
  startedAt   DateTime  @default(now()) @map("started_at") @db.Timestamptz
  completedAt DateTime? @map("completed_at") @db.Timestamptz
  error       String?
  metadata    Json      @default("{}")

  @@map("job_runs")
}
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm --filter @rivocloud/db install`
Expected: installs `@prisma/client`, `prisma`, `vitest`, `typescript` into `packages/db/node_modules`.

- [ ] **Step 6: Validate the schema**

Run: `cd packages/db && pnpm exec prisma validate && cd ../..`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 7: Run the first migration against the Task 2 Postgres instance**

Run: `DATABASE_URL="postgresql://rivocloud:rivocloud_dev_password@localhost:5432/rivocloud" pnpm --filter @rivocloud/db exec prisma migrate dev --name init`
Expected: creates `packages/db/prisma/migrations/<timestamp>_init/migration.sql`, applies it to the running Postgres container, prints `Your database is now in sync with your schema.` and generates the Prisma Client.

- [ ] **Step 8: Create `packages/db/src/index.ts`**

```typescript
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 9: Write the integration test — `packages/db/src/client.integration.test.ts`**

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './index';

describe('prisma client against a real Postgres instance', () => {
  beforeEach(async () => {
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a user and reads it back', async () => {
    const user = await prisma.user.create({
      data: { email: 'founder@rivocloud.dev', name: 'Founder' },
    });

    const found = await prisma.user.findUnique({ where: { id: user.id } });

    expect(found?.email).toBe('founder@rivocloud.dev');
    expect(found?.emailVerified).toBe(false);
  });

  it('creates an organization owned by a user and lists its members', async () => {
    const owner = await prisma.user.create({
      data: { email: 'owner@rivocloud.dev', name: 'Owner' },
    });

    const org = await prisma.organization.create({
      data: { name: 'Acme Inc', slug: 'acme-inc', ownerId: owner.id },
    });

    await prisma.organizationMember.create({
      data: { orgId: org.id, userId: owner.id, role: 'owner' },
    });

    const members = await prisma.organizationMember.findMany({ where: { orgId: org.id } });

    expect(members).toHaveLength(1);
    expect(members[0].role).toBe('owner');
  });

  it('enforces the unique (orgId, slug) constraint on pull zones', async () => {
    const owner = await prisma.user.create({
      data: { email: 'zones@rivocloud.dev', name: 'Zone Owner' },
    });
    const org = await prisma.organization.create({
      data: { name: 'Zone Org', slug: 'zone-org', ownerId: owner.id },
    });

    await prisma.pullZone.create({
      data: { orgId: org.id, name: 'assets', slug: 'assets', originUrl: 'https://origin.example.com' },
    });

    await expect(
      prisma.pullZone.create({
        data: { orgId: org.id, name: 'assets-2', slug: 'assets', originUrl: 'https://origin2.example.com' },
      }),
    ).rejects.toThrow();

    await prisma.pullZone.deleteMany({ where: { orgId: org.id } });
  });
});
```

- [ ] **Step 10: Run the integration test**

Run: `DATABASE_URL="postgresql://rivocloud:rivocloud_dev_password@localhost:5432/rivocloud" pnpm --filter @rivocloud/db test:integration`
Expected: PASS — 3 tests passed, all against the live Postgres container started in Task 2.

- [ ] **Step 11: Run typecheck and lint**

Run: `pnpm --filter @rivocloud/db typecheck && pnpm --filter @rivocloud/db lint`
Expected: both exit 0. (The generated Prisma client under `node_modules/.prisma` is excluded from lint via `.gitignore`/default ESLint ignores of `node_modules`.)

- [ ] **Step 12: Commit**

```bash
git add packages/db
git commit -m "feat: add @rivocloud/db package with full Phase 1 Prisma schema and initial migration"
```

---

### Task 5: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `turbo` scripts (Task 1), `@rivocloud/config` (Task 3), `@rivocloud/db` (Task 4, including its `prisma migrate deploy` script).
- Produces: a `ci.yml` workflow that later stages extend — when Stage 2 (Identity Service) adds Redis-dependent code, add a `redis` service block to `test-integration`; when Stage 3 (Edge Proxy) adds Go code, add a `build-go` job.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint typecheck

  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo test:unit

  test-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: rivocloud
          POSTGRES_USER: rivocloud
          POSTGRES_PASSWORD: rivocloud_dev_password
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U rivocloud"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://rivocloud:rivocloud_dev_password@localhost:5432/rivocloud
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @rivocloud/db exec prisma migrate deploy
      - run: pnpm turbo test:integration

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: pnpm audit
        run: pnpm audit --audit-level=high
        continue-on-error: true
```

- [ ] **Step 2: Run the same steps locally to confirm they'd pass in CI**

Run:
```bash
pnpm install --frozen-lockfile
pnpm turbo lint typecheck
pnpm turbo test:unit
DATABASE_URL="postgresql://rivocloud:rivocloud_dev_password@localhost:5432/rivocloud" pnpm --filter @rivocloud/db exec prisma migrate deploy
DATABASE_URL="postgresql://rivocloud:rivocloud_dev_password@localhost:5432/rivocloud" pnpm turbo test:integration
```
Expected: every command exits 0 — this is exactly what the four CI jobs run, just executed locally against the Task 2 Postgres instead of the GitHub-hosted Postgres service container.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint/typecheck, unit, integration, and security-scan pipeline"
```

---

## Definition of Done for Stage 1

- `pnpm install` succeeds from a clean clone.
- `./scripts/dev.sh` brings up Postgres, Redis, MinIO, ClickHouse, NATS, Prometheus, Grafana, and Loki locally via one command.
- `pnpm turbo lint typecheck test:unit` passes with zero application code beyond `packages/config` and `packages/db`.
- `pnpm --filter @rivocloud/db test:integration` passes against the live Postgres container, exercising the full Phase 1 schema (users, orgs, zones, buckets, billing, audit — all 19 tables from EDD §6.1-6.5).
- `.github/workflows/ci.yml` mirrors all of the above so a PR gets the same signal.
- Nothing in `apps/` exists yet — Stage 2 (Identity Service) is the next stage per `docs/phase1-development-flow.md` and creates `apps/identity-service` on top of this foundation.
