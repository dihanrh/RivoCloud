# RivoCloud — Phase 1 CDN Engineering Design Document

**Version:** 1.0
**Date:** 2026-06-29
**Phase:** 1 — RivoCloud CDN
**Status:** Approved
**Companion:** 2026-06-29-Rivocloud-master-architecture.md

---

## Table of Contents

1. [Phase 1 Scope and Goals](#1-phase-1-scope-and-goals)
2. [Microservices Design](#2-microservices-design)
3. [Infrastructure](#3-infrastructure)
4. [Storage Architecture](#4-storage-architecture)
5. [CDN Architecture](#5-cdn-architecture)
6. [Database Schema](#6-database-schema)
7. [REST API Design](#7-rest-api-design)
8. [Security Architecture](#8-security-architecture)
9. [Deployment Strategy](#9-deployment-strategy)
10. [Development Roadmap](#10-development-roadmap)
11. [Development Order](#11-development-order)

---

## 1. Phase 1 Scope and Goals

### What Phase 1 Delivers

Phase 1 is RivoCloud CDN — a production-quality CDN platform with object storage, custom domains, cache management, analytics, and a developer-facing dashboard. At the end of Phase 1, RivoCloud can onboard paying customers.

### Feature Checklist

| Feature                                    | Priority | Month   |
| ------------------------------------------ | -------- | ------- |
| Origin pull CDN (proxy to customer origin) | P0       | 2       |
| Redis-backed edge cache                    | P0       | 2       |
| Custom domains with auto-TLS               | P0       | 3       |
| Organization and project management        | P0       | 1       |
| API key management with RBAC               | P0       | 1       |
| Object storage (MinIO, S3-compatible API)  | P0       | 3       |
| Origin push (pre-populate storage)         | P1       | 3       |
| Cache rules engine (per-zone TTL rules)    | P1       | 4       |
| Cache invalidation (path patterns)         | P1       | 4       |
| Cache invalidation by tag                  | P1       | 4       |
| Signed URLs (private content)              | P1       | 6       |
| HTTPS enforcement                          | P0       | 3       |
| Cache analytics (hits, misses, bandwidth)  | P1       | 5       |
| Request analytics (countries, latency)     | P1       | 5       |
| Multi-tenant billing (Stripe)              | P2       | 7       |
| Dashboard (full web UI)                    | P1       | ongoing |
| JavaScript SDK                             | P2       | 9       |
| CLI                                        | P2       | 9       |
| First real edge PoP (Hetzner)              | P1       | 8       |

### What Phase 1 Explicitly Does Not Include

- Image optimization / video transcoding (Phase 2)
- Edge Functions / WASM runtime (Phase 3)
- AI Cache / semantic caching (Phase 4)
- API Gateway (Phase 3)
- Multi-region PostgreSQL (Phase 3+)
- BGP Anycast (Phase 3+)
- Customer webhooks / webhook delivery infrastructure (Phase 2)
- Object versioning API and UI (Phase 2 — schema is ready)
- Lifecycle policy execution (Phase 2 — schema is ready)

**Phase 1 geographic scope:** Single control plane (Oracle Cloud) + up to 3 Hetzner edge PoPs. This is not multi-region — the control plane is single-region. Multi-region control plane and global Anycast routing are Stage 5+ (Year 2) from the master architecture. Phase 1 Month 8 delivers one additional PoP, not a multi-region architecture.

---

## 2. Microservices Design

### Service Map

```
                           ┌─────────────┐
                           │   Traefik   │
                           │  API Gateway│
                           └──────┬──────┘
            ┌──────────────┬──────┼──────┬──────────────┐
            │              │      │      │              │
     ┌──────▼──────┐ ┌─────▼──┐  │  ┌───▼────┐  ┌─────▼──────┐
     │  Identity   │ │  CDN   │  │  │Storage │  │ Analytics  │
     │  Service    │ │Service │  │  │Service │  │  Service   │
     └──────┬──────┘ └───┬────┘  │  └───┬────┘  └─────┬──────┘
            │            │       │      │              │
     ┌──────▼──────┐     │  ┌────▼────┐ │         ┌───▼─────┐
     │  Billing    │     │  │Dashboard│ │         │ClickHse │
     │  Service    │     │  └─────────┘ │         └─────────┘
     └─────────────┘     │              │
                         │    NATS      │
                    ┌────▼──────────────▼────┐
                    │      Edge Proxy (Go)    │
                    │   (edge nodes + PoPs)   │
                    └────────────────────────┘
```

---

### 2.1 Edge Proxy (Go)

**The most important service.** This is the data plane — every byte of customer traffic passes through it.

**Responsibilities:**

- Accept HTTP/HTTPS requests on behalf of customer domains
- Implement a 3-layer cache: in-process LRU → local Redis → origin/MinIO
- Forward cache misses to customer origin or MinIO
- Apply cache rules (TTL, bypass conditions, key normalization)
- Handle HTTP semantics: ETag, If-None-Match, Range, Accept-Encoding, Vary
- Compress responses (gzip, brotli) at cache time
- Verify signed URL signatures (HMAC-SHA256, no control plane round-trip)
- Emit request events to NATS for analytics ingestion
- Subscribe to NATS cache invalidation events and purge local caches

**Architecture (internal):**

```
Incoming Request
      │
      ▼
 ┌─────────────────────────────────────────────┐
 │              Request Pipeline               │
 │                                             │
 │  1. Domain lookup (zone config from Redis)  │
 │  2. Signed URL verification (if required)  │
 │  3. Cache key construction                  │
 │  4. L1 check (in-process LRU)              │
 │  5. L2 check (local Redis)                 │
 │  6. L3 check (MinIO / origin forward)      │
 │  7. Response compression                   │
 │  8. Set cache headers                       │
 │  9. Emit analytics event (async goroutine) │
 └─────────────────────────────────────────────┘
```

**Zone config loading:**

- At startup: pull all active zone configs from Control Plane API into Redis
- Subscribe to NATS topic `config.zones.updated` — refresh specific zone on change
- Zone config cached in-process for 60 seconds (avoids Redis round-trip per request)
- Config structure stored as JSON in Redis: `zone_config:{zone_id}`
- NATS resilience: if a `config.zones.updated` event is missed (network blip), the 60-second TTL is the safety net — within 60 seconds the proxy re-reads from Redis. Redis is the authoritative config source; NATS is a faster-than-TTL invalidation signal, not the only delivery path. NATS JetStream at-least-once delivery ensures events are replayed on reconnect.
- NATS JetStream is enabled from Phase 1 (not deferred).

**Scaling strategy:**

- Stateless: any number of replicas can run simultaneously
- Each replica has its own in-process LRU (not shared — acceptable for CDN)
- Local Redis is shared within a PoP (all replicas in same PoP share Redis)
- Horizontal: add replicas, add PoPs
- Deployment: Docker Compose per edge node; k3s manifests for Oracle PoP

**Dependencies:**

- Redis (local, per PoP)
- NATS (for invalidation events + analytics event emission)
- MinIO (L3 cache / origin storage — accessed via S3 API)
- Control Plane API (zone config sync at startup — not on hot path)

**Key Go packages:**

- `net/http` or `valyala/fasthttp` for HTTP server
- `go-redis/redis/v9` for Redis client
- `minio/minio-go` for MinIO S3 client
- `nats-io/nats.go` for NATS client
- `hashicorp/golang-lru/v2` for in-process LRU

---

### 2.2 Identity Service (NestJS)

**Responsibilities:**

- User registration, login, email verification
- JWT access token (15-minute TTL) + refresh token (30-day TTL, stored in Redis)
- Organization creation and management
- Organization member invitations and role assignment
- API key creation, listing, Rivocation (keys are hashed with bcrypt before storage)
- Token Rivocation (JWT blacklist in Redis)

**Scaling strategy:**

- Stateless (all session state in Redis)
- Horizontal: any number of replicas
- PostgreSQL read replica for read-heavy operations (user lookups during auth)

**Dependencies:**

- PostgreSQL (users, organizations, members, API keys)
- Redis (refresh tokens, JWT blacklist, rate limiting)
- NATS (publish `user.registered`, `org.created` events for notifications)
- Resend / SMTP (email verification via Notification Service)

**Internal APIs (consumed by other services, not external):**

- `POST /internal/verify-token` — validate JWT, return user + org context
- `POST /internal/verify-api-key` — validate API key, return permissions
- These are called by Traefik middleware before forwarding to other services

---

### 2.3 CDN Service (NestJS)

**Responsibilities:**

- Pull zone CRUD (create, read, update, delete)
- Custom domain management (add domain → issue Let's Encrypt cert via Traefik)
- Cache rule management (URL pattern → TTL, browser TTL, bypass rules)
- Cache invalidation request handling (write to DB + publish NATS event)
- Zone config publication (publish updated config to Redis on zone change)
- Zone statistics (read from Analytics Service)

**Cache rule model:**
A zone can have multiple cache rules evaluated in priority order:

```
Rule 1: /api/* → TTL: 0 (bypass cache)
Rule 2: /assets/*.js → TTL: 365d (immutable)
Rule 3: /images/* → TTL: 7d, Browser TTL: 1d
Default: → TTL: 1h
```

**Scaling strategy:**

- Stateless
- Write-heavy operations (zone creation, domain verification) are rare — PostgreSQL primary handles it
- Read operations (zone config fetch) use read replica

**Dependencies:**

- PostgreSQL (zones, domains, cache rules)
- Redis (publish zone config updates)
- NATS (publish cache invalidation events)
- Identity Service (auth context validation)

---

### 2.4 Storage Service (NestJS)

**Responsibilities (Phase 1):**

- Bucket CRUD (create, read, update, delete)
- Object metadata management (keys, sizes, content-types, ETags)
- Generate presigned MinIO upload URLs (client uploads directly to MinIO, bypassing this service)
- Generate signed download URLs (HMAC-SHA256, verified at edge)
- Object deletion (soft-delete metadata, async MinIO deletion via background goroutine)
- Multipart upload coordination

**Deferred to Phase 2:**

- Object versioning (schema has `version_id` column ready; API and UI deferred)
- Lifecycle policies (schema has `lifecycle_rules JSONB` column ready; Scheduler execution deferred)
  Both are designed into the schema now to avoid a migration later, but the execution logic is Phase 2 scope.

**Upload flow:**

```
Client → POST /buckets/:id/objects/upload
  Storage Service validates auth + bucket permissions
  Storage Service creates object metadata record (status: pending)
  Storage Service calls MinIO.PresignedPutObject → returns presigned URL
  Returns: { uploadUrl, objectId }

Client → PUT <presigned MinIO URL> (direct, bypasses Storage Service)
  MinIO stores object

MinIO → webhook → Storage Service: object.uploaded
  Storage Service updates object metadata: status: ready, size, etag
  Storage Service publishes NATS event: object.uploaded {bucket_id, key}
```

**Scaling strategy:**

- Stateless
- MinIO handles all I/O — Storage Service handles only metadata
- Presigned URL generation is CPU-light

**Dependencies:**

- PostgreSQL (buckets, objects, versions, lifecycle policies)
- MinIO (object storage backend)
- NATS (publish object lifecycle events)
- Identity Service (auth)

---

### 2.5 Analytics Service (NestJS + ClickHouse)

**Responsibilities:**

- Receive raw request events from edge proxies (via NATS subscription)
- Batch-insert events into ClickHouse (batches of 1,000 or every 5 seconds)
- Serve aggregated analytics queries for the dashboard
- Pre-compute hourly and daily rollups for common metrics

**Event schema (NATS → ClickHouse):**

```json
{
  "timestamp": "2026-06-29T10:00:00Z",
  "zone_id": "zone_abc123",
  "org_id": "org_xyz789",
  "datacenter": "Nuremberg-HZ-1",
  "method": "GET",
  "path": "/assets/main.js",
  "status_code": 200,
  "cache_status": "HIT",
  "bytes_sent": 45231,
  "duration_ms": 12,
  "country": "DE",
  "client_ip_hash": "sha256_hash_of_ip"
}
```

**Analytics queries served:**

- Bandwidth over time (hourly/daily rollup)
- Request count over time
- Cache hit ratio (hits / total requests)
- Status code distribution
- Requests by country (top 10)
- P50/P95/P99 response latency
- Top requested paths

**Scaling strategy:**

- Ingestion: stateless, scale horizontally; NATS distributes events
- ClickHouse handles query load; scale ClickHouse independently
- Pre-compute rollups via Scheduler to reduce query cost on dashboard load

**Dependencies:**

- ClickHouse (analytics storage)
- NATS (subscribe to `edge.request` events)
- PostgreSQL (zone/org metadata for dimension enrichment)

---

### 2.6 Billing Service (NestJS)

**Responsibilities:**

- Record usage events (bandwidth, requests, storage bytes) per organization
- Aggregate usage into billing periods (monthly)
- Stripe Customer creation and management
- Stripe Subscription management (plan selection, upgrades, downgrades)
- Handle Stripe webhooks (payment success, failure, subscription cancellation)
- Enforce plan limits (bandwidth cap, request cap, storage cap)
- Generate usage summaries for invoices

**Plan enforcement:**

- Analytics Service publishes daily usage rollups to NATS
- Billing Service subscribes, updates usage_records table
- On zone config fetch: CDN Service embeds `billing_suspended: true/false` in the zone config stored in Redis
- Edge proxy checks this flag from its local zone config — no synchronous billing call on the hot path
- Billing Service writes `billing_suspended: true` to the zone config in Redis when a limit is breached; NATS event triggers edge proxy config refresh (same path as zone config update)
- Race condition on limit cache expiry: if the Redis key expires before the flag is refreshed, the edge proxy re-reads from Redis (its TTL safety net). The window where an over-limit org could serve traffic is bounded by the 60-second in-process TTL. This is acceptable — blocking all traffic immediately on a Redis miss would cause outages during Redis restarts.

**Scaling strategy:**

- Low traffic, stateless
- Stripe webhook endpoint must be idempotent (Stripe retries on failure)

**Dependencies:**

- PostgreSQL (billing accounts, usage records, invoices)
- Stripe API
- NATS (subscribe to usage rollup events)
- Redis (plan limit cache)

---

### 2.7 Notification Service (NestJS)

**Responsibilities (Phase 1 — email only):**

- Send transactional emails: registration confirmation, domain SSL ready, usage limit alert, invoice generated
- Customer webhooks are **deferred to Phase 2** — the infrastructure (NATS, event schemas) is designed to support them, but building webhook delivery (retry logic, dead-letter queue, customer URL management, signature verification docs) is non-trivial and not required for Phase 1 paying customers.

**Design:**

- Purely event-driven: subscribes to NATS events, never called synchronously
- Email: Resend API (simple HTTP API, no SMTP server to operate)

**Dependencies:**

- NATS (subscribe to: `user.registered`, `domain.verified`, `billing.limit_reached`, `invoice.created`)
- Resend API
- PostgreSQL (user email addresses)

---

### 2.8 Scheduler (NestJS)

**Responsibilities:**

- Object lifecycle policy execution (expire objects after N days, transition storage class)
- Cache warming (pre-fetch popular paths after deployment)
- Daily usage rollup computation (read from ClickHouse → publish to NATS → Billing Service consumes)
- SSL certificate renewal checks (Traefik handles renewal, but Scheduler monitors expiry)
- Stale zone cleanup (zones deleted by users, remove DNS records and MinIO objects)

**Design:**

- Single replica (to avoid duplicate job execution — use Kubernetes leader election for HA)
- Uses NestJS `@nestjs/schedule` (`@Cron` decorators)
- Long-running jobs tracked in PostgreSQL (job_runs table: started_at, completed_at, status)
- Each job is idempotent (safe to re-run if it fails mid-way)

**Dependencies:**

- PostgreSQL (job tracking, lifecycle policies)
- ClickHouse (usage aggregation source)
- NATS (publish usage rollups, object expiration events)
- MinIO (object deletion)

---

### 2.9 Dashboard (Next.js)

**Responsibilities:**

- Web UI for all RivoCloud features: zone management, storage, analytics, billing, settings
- Server-side rendering for initial load performance
- API calls proxied through Next.js API routes (avoids CORS issues, adds server-side auth)

**Key pages:**

- `/` — Landing page
- `/login`, `/register` — Auth
- `/dashboard` — Overview with bandwidth + cache hit ratio summary
- `/zones` — List pull zones
- `/zones/[id]` — Zone detail: cache rules, custom domains, analytics, invalidation
- `/storage` — Bucket list
- `/storage/[bucket]` — Object browser
- `/analytics` — Full analytics dashboard
- `/billing` — Plan, usage, invoices
- `/settings` — Organization settings, API keys, members

**Tech stack:**

- Next.js 15 (App Router)
- shadcn/ui component library (Tailwind CSS)
- Recharts for analytics graphs
- TanStack Query for data fetching and caching
- Zod for client-side validation

**Deployment:** Docker container on Oracle (control plane), or Vercel for simplicity.

---

## 3. Infrastructure

### 3.1 Docker Compose (Development)

Full local stack in a single `docker compose up`:

```yaml
# infrastructure/compose/docker-compose.yml

services:
  # ── Ingress ───────────────────────────────────────────
  traefik:
    image: traefik:v3
    ports: ["80:80", "443:443", "8080:8080"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./traefik/traefik.yml:/etc/traefik/traefik.yml
    networks: [Rivocloud]

  # ── Control Plane Services ────────────────────────────
  identity-service:
    build: ../../apps/identity-service
    environment: [DATABASE_URL, REDIS_URL, NATS_URL, JWT_SECRET]
    labels: [traefik routing rules]
    networks: [Rivocloud]

  cdn-service:
    build: ../../apps/cdn-service
    environment: [DATABASE_URL, REDIS_URL, NATS_URL]
    networks: [Rivocloud]

  storage-service:
    build: ../../apps/storage-service
    environment: [DATABASE_URL, MINIO_URL, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, NATS_URL]
    networks: [Rivocloud]

  analytics-service:
    build: ../../apps/analytics-service
    environment: [CLICKHOUSE_URL, NATS_URL, DATABASE_URL]
    networks: [Rivocloud]

  billing-service:
    build: ../../apps/billing-service
    environment: [DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NATS_URL, REDIS_URL]
    networks: [Rivocloud]

  notification-service:
    build: ../../apps/notification-service
    environment: [DATABASE_URL, RESEND_API_KEY, NATS_URL]
    networks: [Rivocloud]

  scheduler:
    build: ../../apps/scheduler
    environment: [DATABASE_URL, CLICKHOUSE_URL, NATS_URL]
    networks: [Rivocloud]

  dashboard:
    build: ../../apps/dashboard
    environment: [NEXT_PUBLIC_API_URL]
    networks: [Rivocloud]

  # ── Data Plane ────────────────────────────────────────
  edge-proxy:
    build: ../../apps/edge-proxy
    ports: ["8888:8888"]
    environment: [REDIS_URL, NATS_URL, MINIO_URL, CONTROL_PLANE_URL]
    networks: [Rivocloud]

  # ── Infrastructure ────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    environment: [POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD]
    volumes: [postgres_data:/var/lib/postgresql/data]
    networks: [Rivocloud]

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes: [redis_data:/data]
    networks: [Rivocloud]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment: [MINIO_ROOT_USER, MINIO_ROOT_PASSWORD]
    ports: ["9000:9000", "9001:9001"]
    volumes: [minio_data:/data]
    networks: [Rivocloud]

  clickhouse:
    image: clickhouse/clickhouse-server:23
    volumes: [clickhouse_data:/var/lib/clickhouse]
    networks: [Rivocloud]

  nats:
    image: nats:2-alpine
    command: -js -m 8222  # Enable JetStream
    ports: ["4222:4222", "8222:8222"]
    networks: [Rivocloud]

  # ── Observability ─────────────────────────────────────
  prometheus:
    image: prom/prometheus:latest
    volumes: [./prometheus.yml:/etc/prometheus/prometheus.yml]
    networks: [Rivocloud]

  grafana:
    image: grafana/grafana:latest
    environment: [GF_AUTH_ANONYMOUS_ENABLED=true]
    ports: ["3000:3000"]
    networks: [Rivocloud]

  loki:
    image: grafana/loki:latest
    networks: [Rivocloud]

volumes: [postgres_data, redis_data, minio_data, clickhouse_data]
networks:
  Rivocloud:
    driver: bridge
```

### 3.2 Kubernetes — Oracle Cloud (Production)

**Cluster setup:** k3s on 2× Oracle ARM instances (A1.Flex, always free)

```
┌─────────────────────────────────────────────────────────────────┐
│  Oracle Cloud — A1.Flex (4 cores, 24GB RAM each)                │
│                                                                 │
│  Node 1: k3s control + worker                                   │
│  Node 2: k3s worker                                             │
│                                                                 │
│  Namespace: Rivocloud-control                                   │
│    Deployments: identity, cdn, storage, analytics, billing,     │
│                 notification, dashboard                         │
│    HPA: analytics (1-5 replicas), storage (1-3)                │
│                                                                 │
│  Namespace: Rivocloud-infra                                     │
│    StatefulSet: postgres (primary + 1 replica via Patroni)      │
│    StatefulSet: redis (3-node Sentinel)                        │
│    StatefulSet: minio (4 PVCs, erasure coding)                 │
│    StatefulSet: clickhouse (single node initially)             │
│    StatefulSet: nats (3-node JetStream cluster)                │
│                                                                 │
│  Namespace: Rivocloud-monitoring                                │
│    Deployments: prometheus, grafana, loki, tempo               │
│                                                                 │
│  Namespace: Rivocloud-data (edge-proxy on Oracle PoP)           │
│    DaemonSet: edge-proxy (1 per node)                          │
│    StatefulSet: redis-edge (per-PoP cache)                     │
└─────────────────────────────────────────────────────────────────┘
```

**GitOps:** ArgoCD watches `infrastructure/kubernetes/` in the monorepo. Any merged change to K8s manifests triggers automatic sync to the cluster.

### 3.3 Edge Node — Hetzner (Per PoP)

Each edge node is a Hetzner CX21 (2 cores, 4GB RAM, €5.29/month):

```
Hetzner CX21
├── Docker (no Kubernetes — edge simplicity)
├── docker-compose.edge.yml:
│   ├── edge-proxy (Go) — 2 replicas
│   ├── redis-edge — local cache (2GB max memory)
│   └── node-exporter — metrics for Prometheus
├── nginx (optional) — load balance between edge-proxy replicas
└── fail2ban — basic DDoS mitigation
```

**Edge node bootstrap sequence:**

1. Ansible playbook provisions the Hetzner VPS
2. Docker + Docker Compose installed
3. `docker-compose.edge.yml` deployed
4. Edge proxy starts → reads `CONTROL_PLANE_URL`, `NATS_URL` from environment
5. Edge proxy fetches all active zone configs from Control Plane API → stores in local Redis
6. Edge proxy subscribes to NATS topics: `cache.invalidate.*`, `config.zones.*`
7. Node is live, DNS record pointing to its IP added

---

## 4. Storage Architecture

### 4.1 Storage Hierarchy

```
                    ┌─────────────────────┐
                    │      CLIENT         │
                    └─────────┬───────────┘
                              │ CDN request
                              ▼
            ┌─────────────────────────────────┐
            │     EDGE PROXY (Go)              │
            │                                 │
            │  L1: In-Process LRU             │
            │      ~256MB per process         │
            │      TTL: 60s (hot objects)     │
            │      ~0.1ms lookup              │
            │                ▼ miss           │
            │  L2: Local Redis (per PoP)      │
            │      ~2GB                       │
            │      TTL: per cache-control     │
            │      ~0.5ms lookup              │
            │                ▼ miss           │
            │  L3: MinIO Object Storage       │
            │      Unlimited capacity         │
            │      ~20-50ms (LAN)             │
            │                ▼ miss           │
            │  L4: Customer Origin            │
            │      Internet latency           │
            └─────────────────────────────────┘
```

**L1 (In-Process LRU):**

- Go `sync.Map` with an LRU eviction policy
- Stores: full HTTP response (headers + body) for objects ≤ 5MB
- Not shared across replicas (each process has its own — correct for CDN)
- Eviction: LRU on memory pressure, hard TTL of 60 seconds
- Why 60 seconds: cache invalidation events propagate within ~1 second via NATS. The 60-second TTL is a safety net, not the primary invalidation mechanism.

**L2 (Redis, per PoP):**

- Redis string keys: `cache:{zone_id}:{cache_key_hash}` → serialized HTTP response
- Stores: objects ≤ 50MB
- TTL: from origin Cache-Control or zone default TTL
- Compression: store pre-compressed (gzip + brotli variants separately)
- Why per-PoP (not global): a global Redis cache would require all edge nodes to talk to a central Redis. Network latency from Singapore to Oracle (Frankfurt) would be ~180ms — worse than serving from origin. Each PoP's Redis serves only that PoP's traffic.

**L3 (MinIO):**

- S3-compatible API
- Used for: origin-push objects, media files, any content stored in RivoCloud Storage
- For origin-pull: only the edge proxy response is cached in L1/L2; MinIO is not used for origin-pull (origin-pull means the object lives on the customer's server)
- Erasure coding: 4 drives minimum (2+2 scheme) for data protection

### 4.2 Upload Flow (Origin Push)

```
Step 1: Client requests upload
  POST /api/v1/buckets/{bucket_id}/objects/upload
  Body: { key: "assets/hero.jpg", contentType: "image/jpeg", size: 1234567 }

Step 2: Storage Service validates and creates metadata
  INSERT INTO objects (bucket_id, key, content_type, size, status='pending')
  
Step 3: Storage Service generates presigned MinIO URL
  MinIO.PresignedPutObject(bucket, key, TTL=15min)
  
Step 4: Return to client
  { uploadUrl: "https://minio.internal/bucket/key?X-Amz-Signature=...", objectId: "..." }

Step 5: Client uploads directly to MinIO
  PUT <uploadUrl> (client → MinIO directly, no API proxy)
  
Step 6: MinIO fires event notification (webhook or NATS)
  { event: "s3:ObjectCreated:Put", bucket, key, size, etag }
  
Step 7: Storage Service webhook handler
  UPDATE objects SET status='ready', etag=..., size=... WHERE key=...
  NATS publish: "object.uploaded" { bucket_id, key, org_id }

Step 8: (Optional) Cache warming
  Scheduler or client calls: POST /zones/{id}/cache/warm { paths: ["/assets/hero.jpg"] }
  Edge proxy pre-fetches from MinIO → stores in Redis
```

### 4.3 Download Flow (CDN Serving)

```
Step 1: Client requests object
  GET https://cdn.customer.com/assets/hero.jpg
  DNS → Hetzner edge node (closest PoP)

Step 2: Edge proxy receives request
  Lookup zone config: zone_config:{zone_id} from local in-memory cache
  → Found: { origin_url, cache_rules, signed_url_required, ... }

Step 3: Build cache key
  key = sha256(zone_id + ":" + normalized_path + ":" + vary_headers)
  normalize_path("/assets/hero.jpg?v=1&utm=email") → "/assets/hero.jpg"
  (query param stripping per cache rules)

Step 4: L1 check
  lru.Get(key) → hit: return immediately, set Age header

Step 5: L2 check (Redis)
  redis.Get("cache:" + zone_id + ":" + key)
  → hit: deserialize response, write to L1, return

Step 6: L3/L4 — Fetch from source
  if zone.storage_type == "push":
    // Push zone: object lives in RivoCloud's MinIO
    minio.GetObject(bucket, object_key) → cache in L2 + L1, return
  else:
    // Pull zone: forward to customer's origin server (never MinIO)
    http.Get(zone.origin_url + path) → cache in L2 + L1, return

  // Clarification: MinIO is ONLY used for push zones (origin push / RivoCloud Storage).
  // Pull zones always hit the customer's origin URL, never MinIO.
  
Step 7: Set response headers
  Cache-Control: max-age={browser_ttl}
  ETag: {etag}
  Age: {seconds_since_cached}
  X-RivoCloud-Cache: HIT/MISS/STALE
  
Step 8: Emit analytics event (async, non-blocking)
  nats.Publish("edge.request", { zone_id, status_code, cache_status, bytes, latency, country })
```

### 4.4 Cache Invalidation Flow

```
Step 1: User calls API
  POST /api/v1/zones/{zone_id}/cache/invalidate
  Body: { patterns: ["/assets/*", "/index.html"], tags: ["blog-post-123"] }

Step 2: CDN Service
  INSERT INTO cache_invalidations (zone_id, patterns, tags, status='pending', created_at)
  NATS publish: "cache.invalidate.{zone_id}" { zone_id, patterns, tags, invalidation_id }
  Return 202 Accepted: { invalidationId, status: "pending" }

Step 3: All edge proxies (subscribed to "cache.invalidate.*")
  Receive event
  For each pattern: glob-match against L1 keys → delete
  For each pattern: SCAN Redis for matching keys → delete
  NATS reply: { datacenter, keys_purged: 1234, duration_ms: 45 }

Step 4: CDN Service (aggregates replies)
  Wait 5 seconds for replies from all known edge nodes
  UPDATE cache_invalidations SET status='completed', completed_at=...
  
Step 5: User polls (or webhook)
  GET /api/v1/zones/{zone_id}/cache/invalidations/{invalidation_id}
  → { status: "completed", edgesNotified: 3, keysPurged: 3456 }
```

### 4.5 Object Versioning

Every object has a version UUID. When an object is updated:

1. A new record is inserted into `objects` with a new `version_id`, `is_latest: true`
2. The old record is updated: `is_latest: false`
3. Old version remains in MinIO at `{bucket}/{key}/{old_version_id}`
4. Versioned URLs: `https://storage.Rivocloud.dev/bucket/key?version=abc123`

Lifecycle policy example: delete non-latest versions older than 30 days.

---

## 5. CDN Architecture

### 5.1 Origin Pull

Origin pull is the standard CDN mode: RivoCloud sits in front of the customer's existing server. The customer points their DNS to RivoCloud; RivoCloud caches responses.

```
Configuration:
  zone.origin_url = "https://api.customer-backend.com"
  zone.cache_ttl = 3600

Request: GET https://cdn.customer.com/api/products
  → Cache miss
  → Edge proxy: GET https://api.customer-backend.com/api/products
  → Origin returns: 200, Cache-Control: public, max-age=3600
  → Edge caches for 3600s
  → Returns to client with X-RivoCloud-Cache: MISS

Second request (within 3600s):
  → Cache HIT, returns from Redis
  → X-RivoCloud-Cache: HIT, Age: 45
```

**Important origin-pull behaviors:**

- `Cache-Control: no-store` from origin → never cache
- `Cache-Control: private` from origin → never cache
- `Cache-Control: no-cache` from origin → cache but always revalidate (If-None-Match)
- No Cache-Control header → apply zone default TTL

### 5.2 Cache Key Design

The cache key determines whether two requests are treated as the same resource. A poor cache key = duplicate content stored, different objects served the same content, or wrong content served.

```
cache_key = sha256(
  zone_id + "|" +
  "GET" + "|" +                     // always "GET" — HEAD shares the same cache entry as GET
  normalized_host + "|" +           // lowercase, strip port if :80/:443
  normalized_path + "|" +           // lowercase, collapse //
  normalized_query_string + "|" +   // sort params, strip ignored params
  vary_header_values                 // e.g., Accept-Language: en if Vary: Accept-Language
)
// HEAD requests: use the same cache key as GET. The cached GET response is returned
// but only the headers are sent to the client (body stripped). This is correct per RFC 7231 §4.3.2.
// The edge proxy MUST NOT cache HEAD responses separately — doing so would corrupt GET cache entries.
```

**Query string normalization rules (per zone):**

| Mode                           | Example Input                                            | Normalized                          |
| ------------------------------ | -------------------------------------------------------- | ----------------------------------- |
| Strip all (default for assets) | `/img.jpg?v=1&utm=email`                               | `/img.jpg`                        |
| Whitelist                      | `/search?q=cats&page=2&utm=email` (whitelist: q, page) | `/search?page=2&q=cats`           |
| Include all                    | `/api?user=1&ts=1234567`                               | `/api?ts=1234567&user=1` (sorted) |
| Ignore specific                | `/page?content=1&_ga=tracking` (ignore: _ga)           | `/page?content=1`                 |

### 5.3 TTL and Cache-Control Handling

RivoCloud applies a priority hierarchy for TTL. This is the authoritative definition — the master architecture doc defers to Phase 1 EDD on this detail:

```
Priority 1: Zone cache rule match (highest — e.g., /api/* → TTL: 0 bypass)
Priority 2: Origin Cache-Control: max-age=N (origin controls its own TTL)
Priority 3: Origin Expires: header (legacy fallback)
Priority 4: Zone default TTL (configured per zone)
Priority 5: Content-type based default (images: 7d, HTML: 5m, everything else: 1h)
```

There is no separate "RivoCloud edge TTL override" distinct from cache rules. Cache rules ARE the mechanism for operator-defined TTL overrides. A cache rule matching `/assets/*` with TTL: 365d is an operator override at Priority 1.

**Browser TTL vs Edge TTL:**

- Edge TTL: how long the edge caches the object (controlled by RivoCloud)
- Browser TTL: the `max-age` sent to the browser in the response
- These are independent. You can cache on edge for 7 days but tell browsers to cache for 1 hour.
- The response `Cache-Control` header sent to the browser is constructed by the edge proxy, not forwarded from origin.

**Stale content behaviors:**

| Directive                     | Behavior                                                                   |
| ----------------------------- | -------------------------------------------------------------------------- |
| `stale-while-revalidate: N` | Serve stale content for up to N seconds while fetching fresh in background |
| `stale-if-error: N`         | If origin returns 5xx, serve stale content for up to N seconds             |
| Default (no directive)        | On TTL expiry, block client while fetching fresh from origin               |

RivoCloud always adds `stale-if-error: 86400` (24 hours) for cached objects unless origin explicitly disables it. This means origin outages do not immediately cause customer-facing errors.

### 5.4 ETag and Conditional Requests

```
First request:
  Edge → Origin: GET /page.html
  Origin → Edge: 200, ETag: "abc123", Cache-Control: max-age=3600
  Edge: cache { body, headers: { ETag: "abc123" } }
  Edge → Client: 200, ETag: "abc123", Cache-Control: max-age=3600

After TTL expires, next request:
  Edge → Origin: GET /page.html, If-None-Match: "abc123"
  Origin → Edge: 304 Not Modified (no body)
  Edge: refresh TTL of cached content, no re-download
  Edge → Client: 200, ETag: "abc123" (from cache)

If content changed:
  Origin → Edge: 200, ETag: "def456", new body
  Edge: replace cache entry
```

This is critical for bandwidth efficiency — refreshing a 5MB JS bundle that hasn't changed costs 0 bytes of origin bandwidth.

### 5.5 Signed URLs

Signed URLs allow time-limited, optionally IP-restricted access to private objects. The signature is verified at the edge proxy with zero control plane round-trips.

**Signature scheme:**

```
expires_unix = unix_timestamp_when_url_expires
path = "/private/video.mp4"
zone_secret = "zone_signing_secret_from_config"

message = expires_unix + ":" + path
signature = HMAC-SHA256(zone_secret, message)

signed_url = "https://cdn.customer.com/private/video.mp4?expires={expires_unix}&sig={hex(signature)}"
```

**Edge proxy verification:**

```go
func verifySignedURL(r *http.Request, zone *Zone) bool {
    expires := r.URL.Query().Get("expires")
    sig := r.URL.Query().Get("sig")
  
    // Check expiry
    if time.Now().Unix() > parseUnix(expires) {
        return false
    }
  
    // Reconstruct message
    message := expires + ":" + r.URL.Path
  
    // Verify HMAC
    expected := hmac.New(sha256.New, []byte(zone.SigningSecret))
    expected.Write([]byte(message))
  
    return hmac.Equal([]byte(sig), []byte(hex.EncodeToString(expected.Sum(nil))))
}
```

**Zone signing secret caching:**

- Zone secrets are stored in PostgreSQL (encrypted at rest)
- Edge proxy caches secrets in Redis with a 60-second TTL
- On secret rotation: CDN Service updates PostgreSQL, publishes NATS event, edges flush cache

**Optional modifiers:**

- `&ip=203.0.113.0/24` — restrict to IP range (checked at edge)
- `&download=1` — force `Content-Disposition: attachment`
- `&filename=report.pdf` — set download filename

### 5.6 Range Requests

Required for: video streaming (seeking), large file downloads with pause/resume.

```
Client: GET /video.mp4 HTTP/1.1, Range: bytes=1048576-2097151

Edge proxy (object is cached):
  Read bytes 1048576–2097151 from cached object
  Return: 206 Partial Content, Content-Range: bytes 1048576-2097151/104857600

Edge proxy (object not cached):
  Option A: Forward Range header to origin, cache partial response
  Option B: Fetch full object, cache it, serve partial from cache
  
Recommendation: Option B for objects < 50MB (avoids partial-content caching complexity)
                Option A for large objects (video) — cache chunks separately
```

### 5.7 Compression

```
Incoming request: Accept-Encoding: gzip, br

Edge proxy behavior:
  1. Construct cache key WITHOUT Accept-Encoding (content is the same)
  2. Check cache for brotli variant first (better compression)
     cache_key_br = cache_key + ":br"
  3. If br variant exists: return it
  4. If gzip variant exists: return it
  5. If uncompressed exists: compress on-the-fly, store both variants, return
  6. If nothing: fetch from origin, compress, store both, return

Storage:
  Redis key "cache:{zone}:{key}:br" → brotli-compressed body
  Redis key "cache:{zone}:{key}:gz" → gzip-compressed body
  Redis key "cache:{zone}:{key}" → uncompressed body (optional, for non-compressible types)
```

**Content types that are compressed:** text/html, text/css, application/javascript, application/json, text/plain, application/xml
**Content types that are NOT compressed:** image/*, video/*, audio/*, application/zip, application/pdf (already compressed)

### 5.8 HTTPS and Custom Domains

**How custom domains work:**

1. Customer adds domain in Dashboard: `cdn.their-company.com`
2. CDN Service creates domain record in PostgreSQL (status: pending_dns)
3. Dashboard shows: "Add CNAME record: `cdn.their-company.com` → `edge.Rivocloud.dev`"
4. CDN Service polls DNS every 30 seconds (or customer clicks "Verify")
5. Once DNS resolves: update status to `pending_ssl`
6. Traefik (with Let's Encrypt) automatically provisions SSL certificate for the domain
7. CDN Service webhook from Traefik (or poll): certificate issued → status: `active`
8. Edge proxy's Traefik ingress now routes `cdn.their-company.com` to edge proxy

**Traefik configuration for dynamic domains:**

- Traefik reads domain configs from Redis (via Traefik Redis provider)
- CDN Service writes new domain to Redis: `traefik/http/routers/{domain}/rule: Host(\`cdn.their-company.com\`)`
- Traefik picks up the change automatically, provisions Let's Encrypt cert
- No Traefik restart required

**Wildcard RivoCloud subdomains:**

- Every zone gets a default subdomain: `{zone-slug}.cdn.Rivocloud.dev`
- This uses the wildcard cert for `*.cdn.Rivocloud.dev` — no cert provisioning delay

---

## 6. Database Schema

All schemas below are for PostgreSQL. Column types use PostgreSQL notation. Analytics tables are in ClickHouse and documented separately.

### 6.1 Identity / Auth Tables

```sql
-- Users
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,                          -- NULL for OAuth users
  name            TEXT NOT NULL,
  avatar_url      TEXT,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth providers (for social login, Phase 2)
CREATE TABLE oauth_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,                 -- 'github', 'google'
  provider_id     TEXT NOT NULL,
  access_token    TEXT,
  refresh_token   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_id)
);

-- Organizations
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,          -- URL-safe identifier
  plan            TEXT NOT NULL DEFAULT 'free',  -- 'free', 'pro', 'enterprise'
  owner_id        UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organization Members
CREATE TABLE organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'developer', -- 'owner', 'admin', 'developer', 'viewer'
  invited_by      UUID REFERENCES users(id),
  joined_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- API Keys
CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id),    -- NULL for org-level keys
  name            TEXT NOT NULL,
  key_hash        TEXT UNIQUE NOT NULL,          -- bcrypt hash of full key
  key_prefix      TEXT NOT NULL,                 -- first 8 chars for display (e.g., "rc_live_abcd1234")
  permissions     JSONB NOT NULL DEFAULT '[]',   -- ["zone:read", "storage:write", ...]
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,                   -- NULL = never expires
  Rivoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email Verification Tokens
CREATE TABLE email_verification_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT UNIQUE NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.2 CDN Tables

```sql
-- Projects (optional grouping within org)
CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, slug)
);

-- Pull Zones
CREATE TABLE pull_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,                 -- {slug}.cdn.Rivocloud.dev
  origin_url      TEXT NOT NULL,                 -- https://api.customer.com
  origin_protocol TEXT NOT NULL DEFAULT 'https', -- 'http', 'https', 'match'
  cache_ttl       INTEGER NOT NULL DEFAULT 3600, -- seconds, default TTL
  browser_ttl     INTEGER NOT NULL DEFAULT 0,    -- 0 = inherit from edge TTL
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  signing_secret  TEXT,                          -- for signed URLs (bcrypt)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, slug)
);

-- Custom Domains
CREATE TABLE zone_domains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id         UUID NOT NULL REFERENCES pull_zones(id) ON DELETE CASCADE,
  domain          TEXT UNIQUE NOT NULL,
  ssl_status      TEXT NOT NULL DEFAULT 'pending_dns',
                  -- 'pending_dns', 'pending_ssl', 'active', 'error'
  ssl_error       TEXT,
  cert_expires_at TIMESTAMPTZ,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache Rules
CREATE TABLE cache_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id         UUID NOT NULL REFERENCES pull_zones(id) ON DELETE CASCADE,
  pattern         TEXT NOT NULL,                 -- glob pattern: /api/*, /assets/*.js
  pattern_type    TEXT NOT NULL DEFAULT 'glob',  -- 'glob', 'regex', 'exact'
  action          TEXT NOT NULL DEFAULT 'cache', -- 'cache', 'bypass', 'no-store'
  edge_ttl        INTEGER,                       -- NULL = use zone default
  browser_ttl     INTEGER,
  query_string    TEXT NOT NULL DEFAULT 'strip_all', -- 'strip_all', 'whitelist', 'include_all'
  query_whitelist TEXT[],                        -- if query_string='whitelist'
  priority        INTEGER NOT NULL DEFAULT 0,    -- higher = evaluated first
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache Invalidations (audit trail)
CREATE TABLE cache_invalidations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id         UUID NOT NULL REFERENCES pull_zones(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id),
  patterns        TEXT[],
  tags            TEXT[],
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed'
  edges_notified  INTEGER,
  keys_purged     INTEGER,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.3 Storage Tables

```sql
-- Storage Buckets
CREATE TABLE buckets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  region              TEXT NOT NULL DEFAULT 'eu-central',
  versioning_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  public              BOOLEAN NOT NULL DEFAULT FALSE,
  lifecycle_rules     JSONB NOT NULL DEFAULT '[]',
                      -- [{ "id": "1", "prefix": "tmp/", "expireDays": 30 }]
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

-- Objects
CREATE TABLE objects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id       UUID NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,                 -- object path: "assets/hero.jpg"
  version_id      UUID NOT NULL DEFAULT gen_random_uuid(),
  is_latest       BOOLEAN NOT NULL DEFAULT TRUE,
  size            BIGINT,                        -- bytes, NULL until upload complete
  content_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
  etag            TEXT,                          -- MD5 or multipart ETag
  storage_path    TEXT NOT NULL,                 -- MinIO path: {bucket_id}/{key}/{version_id}
  metadata        JSONB NOT NULL DEFAULT '{}',   -- user-defined metadata
  status          TEXT NOT NULL DEFAULT 'pending',
                  -- 'pending', 'ready', 'deleting', 'deleted'
  expires_at      TIMESTAMPTZ,                   -- from lifecycle policy
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bucket_id, key, version_id)
);

CREATE INDEX idx_objects_bucket_key_latest ON objects(bucket_id, key) WHERE is_latest = TRUE;
CREATE INDEX idx_objects_expires ON objects(expires_at) WHERE expires_at IS NOT NULL;

-- Multipart Uploads (in-progress)
CREATE TABLE multipart_uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id       UUID NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
  object_key      TEXT NOT NULL,
  minio_upload_id TEXT NOT NULL,                 -- MinIO multipart upload ID
  parts           JSONB NOT NULL DEFAULT '[]',   -- uploaded part ETags
  expires_at      TIMESTAMPTZ NOT NULL,          -- auto-abort if not completed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.4 Billing Tables

```sql
-- Billing Accounts
CREATE TABLE billing_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID UNIQUE NOT NULL REFERENCES organizations(id),
  stripe_customer_id  TEXT UNIQUE,
  stripe_sub_id       TEXT UNIQUE,
  plan                TEXT NOT NULL DEFAULT 'free',
  status              TEXT NOT NULL DEFAULT 'active',
                      -- 'active', 'past_due', 'cancelled', 'suspended'
  trial_ends_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usage Records (monthly snapshots)
CREATE TABLE usage_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  bandwidth_bytes BIGINT NOT NULL DEFAULT 0,
  requests        BIGINT NOT NULL DEFAULT 0,
  storage_bytes   BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, period_start)
);

-- Invoices
CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  stripe_invoice_id TEXT UNIQUE,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'usd',
  status            TEXT NOT NULL,               -- 'draft', 'open', 'paid', 'void', 'uncollectable'
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.5 Audit + System Tables

```sql
-- Audit Log (all API actions)
CREATE TABLE audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  api_key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,                 -- 'zone.created', 'cache.invalidated', etc.
  resource_type   TEXT,
  resource_id     TEXT,
  ip_address      INET,
  user_agent      TEXT,
  request_id      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC);

-- Scheduler Job Runs
CREATE TABLE job_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  error           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'
);
```

### 6.6 ClickHouse Analytics Tables

```sql
-- Raw request log (ClickHouse)
CREATE TABLE request_logs (
  timestamp       DateTime64(3, 'UTC'),
  zone_id         String,
  org_id          String,
  datacenter      String,                        -- 'Nuremberg-HZ-1', 'Oracle-EU-1'
  method          LowCardinality(String),        -- 'GET', 'HEAD'
  path            String,
  status_code     UInt16,
  cache_status    LowCardinality(String),        -- 'HIT', 'MISS', 'STALE', 'BYPASS', 'EXPIRED'
  bytes_sent      UInt64,
  duration_ms     UInt32,
  country         FixedString(2),                -- ISO-3166 country code
  client_ip_hash  String                         -- SHA256 of client IP (privacy)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (zone_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;

-- Pre-computed hourly rollup (ClickHouse)
CREATE TABLE bandwidth_hourly (
  hour            DateTime,
  zone_id         String,
  org_id          String,
  bytes_sent      UInt64,
  requests        UInt64,
  cache_hits      UInt64,
  cache_misses    UInt64
)
ENGINE = SummingMergeTree()
ORDER BY (zone_id, hour);

-- Country distribution (ClickHouse)
CREATE TABLE requests_by_country_daily (
  date            Date,
  zone_id         String,
  country         FixedString(2),
  requests        UInt64,
  bytes_sent      UInt64
)
ENGINE = SummingMergeTree()
ORDER BY (zone_id, date, country);
```

---

## 7. REST API Design

All endpoints are prefixed with `/api/v1`. Authentication via `Authorization: Bearer <jwt>` or `X-API-Key: rc_live_...`. All responses are JSON.

### 7.1 Auth Endpoints

```
POST   /api/v1/auth/register              Register new user
POST   /api/v1/auth/login                 Login, return access + refresh tokens
POST   /api/v1/auth/refresh               Refresh access token using refresh token
POST   /api/v1/auth/logout                Invalidate refresh token
POST   /api/v1/auth/verify-email          Verify email with token
POST   /api/v1/auth/forgot-password       Send password reset email
POST   /api/v1/auth/reset-password        Reset password with token
```

### 7.2 User Endpoints

```
GET    /api/v1/users/me                   Get current user profile
PATCH  /api/v1/users/me                   Update name, avatar
PATCH  /api/v1/users/me/password          Change password
DELETE /api/v1/users/me                   Delete account (soft delete)
```

### 7.3 Organization Endpoints

```
POST   /api/v1/orgs                       Create organization
GET    /api/v1/orgs                       List user's organizations
GET    /api/v1/orgs/:orgId                Get organization
PATCH  /api/v1/orgs/:orgId                Update name, slug
DELETE /api/v1/orgs/:orgId                Delete organization

GET    /api/v1/orgs/:orgId/members        List members
POST   /api/v1/orgs/:orgId/members        Invite member (sends email)
PATCH  /api/v1/orgs/:orgId/members/:uid   Update member role
DELETE /api/v1/orgs/:orgId/members/:uid   Remove member
```

### 7.4 API Key Endpoints

```
POST   /api/v1/api-keys                   Create API key (returns full key once)
GET    /api/v1/api-keys                   List API keys (prefix only, never full key)
PATCH  /api/v1/api-keys/:keyId            Update name, permissions
DELETE /api/v1/api-keys/:keyId            Rivoke API key
```

### 7.5 CDN / Zone Endpoints

```
POST   /api/v1/zones                      Create pull zone
GET    /api/v1/zones                      List zones (org-scoped, paginated)
GET    /api/v1/zones/:zoneId              Get zone details
PATCH  /api/v1/zones/:zoneId              Update origin URL, default TTL, etc.
DELETE /api/v1/zones/:zoneId              Delete zone

POST   /api/v1/zones/:zoneId/domains      Add custom domain
GET    /api/v1/zones/:zoneId/domains      List domains for zone
DELETE /api/v1/zones/:zoneId/domains/:d   Remove custom domain
POST   /api/v1/zones/:zoneId/domains/:d/verify  Re-check DNS + SSL

POST   /api/v1/zones/:zoneId/rules        Create cache rule
GET    /api/v1/zones/:zoneId/rules        List cache rules
PATCH  /api/v1/zones/:zoneId/rules/:rid   Update cache rule
DELETE /api/v1/zones/:zoneId/rules/:rid   Delete cache rule
POST   /api/v1/zones/:zoneId/rules/reorder Reorder rules by priority

POST   /api/v1/zones/:zoneId/cache/invalidate  Invalidate by patterns / tags
POST   /api/v1/zones/:zoneId/cache/purge       Purge entire zone cache
GET    /api/v1/zones/:zoneId/cache/invalidations  List invalidation history
GET    /api/v1/zones/:zoneId/cache/invalidations/:id  Get invalidation status
```

### 7.6 Storage Endpoints

```
POST   /api/v1/buckets                    Create bucket
GET    /api/v1/buckets                    List buckets (org-scoped)
GET    /api/v1/buckets/:bucketId          Get bucket details + stats
PATCH  /api/v1/buckets/:bucketId          Update settings (versioning, public, lifecycle)
DELETE /api/v1/buckets/:bucketId          Delete bucket (must be empty)

GET    /api/v1/buckets/:bucketId/objects          List objects (paginated, prefix filter)
POST   /api/v1/buckets/:bucketId/objects/upload   Initiate upload, get presigned URL
GET    /api/v1/buckets/:bucketId/objects/:key     Get object metadata
DELETE /api/v1/buckets/:bucketId/objects/:key     Delete object (or version)
POST   /api/v1/buckets/:bucketId/objects/:key/sign  Generate signed URL
POST   /api/v1/buckets/:bucketId/objects/:key/copy  Copy object to another key/bucket
GET    /api/v1/buckets/:bucketId/objects/:key/versions  List versions

POST   /api/v1/buckets/:bucketId/multipart/init       Start multipart upload
POST   /api/v1/buckets/:bucketId/multipart/:id/part   Get presigned URL for part
POST   /api/v1/buckets/:bucketId/multipart/:id/complete  Complete multipart upload
DELETE /api/v1/buckets/:bucketId/multipart/:id        Abort multipart upload
```

### 7.7 Analytics Endpoints

```
GET    /api/v1/analytics/overview         Summary: total bandwidth, requests, hit ratio (org)
GET    /api/v1/analytics/bandwidth        Bandwidth time series (zone, time range, granularity)
GET    /api/v1/analytics/requests         Request count time series
GET    /api/v1/analytics/cache            Cache hit ratio, status breakdown
GET    /api/v1/analytics/geography        Requests by country (top 20)
GET    /api/v1/analytics/latency          P50/P95/P99 latency time series
GET    /api/v1/analytics/status-codes     HTTP status code distribution
GET    /api/v1/analytics/top-paths        Top 50 most-requested paths
```

All analytics endpoints accept:

- `?zoneId=` — filter by zone (optional, default: all zones in org)
- `?from=ISO8601&to=ISO8601` — time range (default: last 24 hours)
- `?granularity=hour|day|week` — aggregation granularity

### 7.8 Billing Endpoints

```
GET    /api/v1/billing/account            Get billing account, current plan
POST   /api/v1/billing/checkout           Create Stripe Checkout session for plan upgrade
POST   /api/v1/billing/portal             Create Stripe Customer Portal session
GET    /api/v1/billing/usage              Current period usage (bandwidth, requests, storage)
GET    /api/v1/billing/invoices           List invoices
GET    /api/v1/billing/invoices/:id       Get invoice + PDF URL
POST   /api/v1/billing/webhook            Stripe webhook receiver (internal, not for customers)
```

### 7.9 Internal APIs (Not Public)

These endpoints are called by services or Traefik middleware — not exposed to customers:

```
POST   /internal/auth/verify-token        Verify JWT → return user + org context
POST   /internal/auth/verify-api-key      Verify API key → return permissions
GET    /internal/zones/config             Get all active zone configs (edge proxy bootstrap)
GET    /internal/zones/:id/config         Get single zone config
POST   /internal/analytics/events         Batch ingest raw request events from edge proxies
```

---

## 8. Security Architecture

### 8.1 Authentication

**JWT structure:**

```json
{
  "sub": "user_uuid",
  "org": "org_uuid",
  "role": "developer",
  "iat": 1719648000,
  "exp": 1719648900,
  "jti": "unique_token_id"
}
```

- Access token: 15-minute TTL, signed with `RS256` (RSA private key, public key for verification)
- Refresh token: 30-day TTL, stored as a hash in Redis, single-use (rotated on each refresh)
- Token Rivocation: Redis set `jwt:blacklist:{jti}` with TTL = remaining token lifetime

**API key format:**

```
rc_live_[32 random bytes as base58]
rc_test_[32 random bytes as base58]

Example: rc_live_3qYJAKRpX8mF2nQ7vDsHbL9wEcT5iUg4
```

- `rc_live_` prefix for production keys, `rc_test_` for sandbox
- Full key shown to user exactly once at creation; stored as bcrypt hash
- First 12 characters stored as `key_prefix` for display in dashboard
- Lookup: `SELECT * FROM api_keys WHERE key_prefix = $1` → bcrypt.Compare(full_key, key_hash)
- Lookups indexed on `key_prefix` to avoid full table scan

### 8.2 Authorization (RBAC)

**Organization roles:**

| Role      | Zone | Storage | Analytics | Billing | Members       | Settings |
| --------- | ---- | ------- | --------- | ------- | ------------- | -------- |
| Owner     | Full | Full    | Full      | Full    | Full          | Full     |
| Admin     | Full | Full    | Full      | Read    | Invite/Remove | Full     |
| Developer | Full | Full    | Full      | None    | None          | Read     |
| Viewer    | Read | Read    | Full      | None    | None          | None     |

**API key permission scopes (fine-grained):**

```
zone:read           List and view zones
zone:write          Create and modify zones
zone:delete         Delete zones
cache:invalidate    Trigger cache invalidation
storage:read        List and download objects
storage:write       Upload objects
storage:delete      Delete objects
analytics:read      Read analytics data
billing:read        Read billing information
```

API keys can have any subset of these scopes, regardless of the creating user's role (a developer cannot grant more permissions than they themselves have).

**Authorization middleware (NestJS Guard):**

```typescript
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extractToken(request);
  
    if (token.startsWith('rc_')) {
      // API key auth
      const key = await this.apiKeyService.verify(token);
      request.auth = { type: 'api_key', key, org: key.org, permissions: key.permissions };
    } else {
      // JWT auth
      const payload = this.jwtService.verify(token);
      request.auth = { type: 'jwt', userId: payload.sub, orgId: payload.org, role: payload.role };
    }
    return true;
  }
}
```

### 8.3 Rate Limiting

| Endpoint Category       | Limit                 | Window   | Key                 |
| ----------------------- | --------------------- | -------- | ------------------- |
| Auth: login, register   | 10 req                | 1 minute | IP address          |
| Auth: forgot password   | 5 req                 | 1 hour   | IP address          |
| API: general            | 1,000 req             | 1 minute | API key or user JWT |
| API: cache invalidation | 100 req               | 1 minute | Zone ID             |
| API: analytics          | 60 req                | 1 minute | User JWT            |
| Edge: CDN requests      | Configurable per zone | —       | —                  |

Implementation: Redis sliding window with `ZADD` + `ZCOUNT` (no Lua scripts required).

### 8.4 Secret Management

**Development:**

- `.env` files, one per service
- `.env.example` committed to git, `.env` in `.gitignore`
- `packages/config/src/env.ts` — Zod schema validates all required env vars at startup

**Production (Kubernetes):**

- Kubernetes Secrets for all sensitive values
- Secrets created via `kubectl create secret` or Sealed Secrets (encrypted in git)
- Services read secrets from mounted files or environment variables (Kubernetes populates from Secret)
- Never use `--from-env-file` with Kubernetes — inject as individual env vars

**Secret rotation procedure:**

1. Generate new secret
2. Update Kubernetes Secret
3. Kubernetes triggers rolling restart of affected Deployments
4. Old pods drain, new pods start with new secret
5. Zero downtime with proper pod disruption budgets

### 8.5 Encryption

| Data                      | At Rest                                | In Transit                        |
| ------------------------- | -------------------------------------- | --------------------------------- |
| PostgreSQL data           | Oracle Cloud disk encryption (AES-256) | TLS 1.3 (PgBouncer → PostgreSQL) |
| Redis data                | Oracle Cloud disk encryption           | TLS (stunnel or Redis TLS mode)   |
| MinIO objects             | MinIO SSE-S3 (AES-256)                 | TLS 1.3                           |
| ClickHouse data           | Oracle Cloud disk encryption           | TLS                               |
| API traffic               | —                                     | TLS 1.2+ (Traefik, Let's Encrypt) |
| Customer objects (signed) | MinIO SSE-S3                           | TLS                               |

**MinIO SSE-S3 configuration (Phase 1 decision: local key management):**

```yaml
environment:
  MINIO_KMS_SECRET_KEY: "my-minio-master-key-32-bytes-hex"
```

Phase 1 uses MinIO's built-in SSE-S3 with a locally managed master key stored in Kubernetes Secrets. KES (Key Encryption Service) integration is deferred to Phase 3 when a dedicated secrets management infrastructure is warranted.

### 8.6 DDoS Protection

**Layer 3/4 (Hetzner edge nodes):**

- Hetzner provides network-level DDoS mitigation automatically
- `fail2ban` configured to block IPs with > 1,000 req/min
- `iptables` rules: rate limit SYN packets, block known attack sources

**Layer 7 (edge proxy):**

- Per-IP rate limiting in Go edge proxy (Redis sliding window)
- Connection limit per IP: max 100 concurrent
- Request size limit: max 10MB request body (CDN requests don't have bodies)
- Timeout: 30-second upstream timeout, 5-second connect timeout

**Control plane:**

- Traefik rate limiting middleware
- Cloudflare in front of `api.Rivocloud.dev` and `dashboard.Rivocloud.dev` (free plan sufficient)

### 8.7 Audit Logging

Every mutating API call writes to `audit_logs`:

```typescript
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(
      tap(() => this.auditService.log({
        orgId: request.auth.orgId,
        userId: request.auth.userId,
        action: `${request.method.toLowerCase()}.${context.getClass().name.toLowerCase()}`,
        resourceType: request.params.resourceType,
        resourceId: request.params.id,
        ipAddress: request.ip,
        requestId: request.headers['x-request-id'],
      }))
    );
  }
}
```

Audit logs are append-only (no UPDATE or DELETE on `audit_logs`). Retained 90 days, then archived to MinIO as compressed JSON.

---

## 9. Deployment Strategy

### 9.1 Development Environment

Every developer runs the full stack locally with a single command:

```bash
# Start all infrastructure + services
./scripts/dev.sh

# Equivalent to:
docker compose -f infrastructure/compose/docker-compose.yml up -d  # Infrastructure
pnpm turbo dev                                                       # All NestJS + Next.js in watch mode
cd apps/edge-proxy && air                                            # Go hot reload (Air)
```

Services are accessed at:

- Dashboard: http://localhost:3001
- API: http://localhost:3000
- Edge Proxy: http://localhost:8888
- MinIO Console: http://localhost:9001
- Grafana: http://localhost:3002
- Traefik Dashboard: http://localhost:8080

### 9.2 CI Pipeline (GitHub Actions)

Every pull request runs:

```yaml
# .github/workflows/ci.yml
jobs:
  lint-and-typecheck:
    - pnpm install
    - pnpm turbo lint typecheck

  test-unit:
    - pnpm turbo test:unit

  test-integration:
    services: [postgres, redis, minio, nats, clickhouse]
    - pnpm turbo test:integration

  build-go:
    - go vet ./...
    - golangci-lint run
    - go test ./...
    - go build ./cmd/proxy/...

  security-scan:
    - trivy image scan (Docker images)
    - govulncheck (Go)
    - pnpm audit (Node.js)
```

### 9.3 Staging Deployment

Auto-deploys on merge to `main`:

```yaml
# .github/workflows/deploy-staging.yml
on:
  push:
    branches: [main]

jobs:
  build-and-push:
    - docker build + push to ghcr.io/Rivocloud/[service]:staging
  
  deploy:
    - kubectl set image deployment/identity-service ...
    - kubectl rollout status deployment/identity-service
    # Repeat for each service
```

Staging URL: `staging.Rivocloud.dev`

### 9.4 Production Deployment (GitOps with ArgoCD)

Production is managed declaratively:

```
Repository: github.com/Rivocloud/infrastructure
  kubernetes/
    overlays/
      production/           # Kustomize overlay
        image-tags.yaml     # Updated by CI with new image SHAs
        values.yaml         # Production-specific configs

ArgoCD Application:
  source: github.com/Rivocloud/infrastructure, path: kubernetes/overlays/production
  destination: k8s cluster
  syncPolicy: automated (prune: true, selfHeal: true)
```

**Production deploy process:**

1. Tag release: `git tag v1.2.3 && git push --tags`
2. GitHub Actions: build Docker images tagged `:v1.2.3`
3. GitHub Actions: update `kubernetes/overlays/production/image-tags.yaml` with new SHAs
4. ArgoCD detects diff → applies new manifests → rolling update

### 9.5 Blue/Green Deployment

For high-risk changes (database migrations, breaking API changes):

```
Current state: Blue deployment is live (100% traffic)

Step 1: Deploy Green
  kubectl apply -f deployments/identity-service-green.yaml

Step 2: Smoke test Green
  kubectl run smoke-test --image=Rivocloud/smoke-tests -- --target=green-internal-svc

Step 3: Shift traffic (Traefik weighted routing)
  Blue: 90%, Green: 10%  → monitor error rate for 5 minutes
  Blue: 50%, Green: 50%  → monitor for 5 minutes
  Blue: 0%,  Green: 100% → Blue becomes the new standby

Step 4: Rollback (if needed)
  kubectl apply -f traefik/routing-blue-100.yaml  → instant rollback
```

### 9.6 Edge Node Deployment

Edge nodes are updated independently from the control plane:

```bash
# scripts/edge-deploy.sh <node-ip>
ssh deploy@<node-ip> "
  docker pull ghcr.io/Rivocloud/edge-proxy:latest
  docker compose -f /opt/Rivocloud/docker-compose.edge.yml up -d --no-deps edge-proxy
  docker compose ps
"
```

Rolling update across all edge nodes:

```bash
for node in ${EDGE_NODES[@]}; do
  ./scripts/edge-deploy.sh $node
  sleep 30  # Stagger to avoid all nodes updating simultaneously
done
```

Edge nodes are updated independently because they do not share state with the control plane at runtime. An edge node running an older version of edge-proxy is still safe — it handles requests correctly with cached zone configs.

---

## 10. Development Roadmap

### Month 1 — Foundation

**Goal:** Monorepo running locally. Identity service complete. Database schema finalized.

**Tasks:**

- Initialize monorepo: pnpm workspaces + Turborepo + go.work
- Set up Docker Compose with all infrastructure services (Postgres, Redis, MinIO, NATS, ClickHouse, Traefik)
- Write complete Prisma schema (all tables defined in Section 6)
- Run initial migrations
- Implement Identity Service fully:
  - POST /auth/register, /login, /refresh, /logout
  - GET /users/me, PATCH /users/me
  - POST /orgs, GET /orgs, PATCH /orgs/:id
  - POST /orgs/:id/members (invite)
  - POST /api-keys, GET /api-keys, DELETE /api-keys/:id
- Set up NestJS auth guard (JWT + API key)
- Dashboard skeleton: login page, register page, dashboard layout (shadcn/ui)
- GitHub Actions CI: lint, typecheck, unit tests
- OTel instrumentation in Identity Service (traces + metrics)

**Deliverable:** `http://localhost:3001` — you can register, log in, create an org, generate an API key.

### Month 2 — Core CDN Proxy

**Goal:** Working CDN proxy with Redis caching. No custom domains yet.

**Tasks:**

- Implement Go edge proxy:
  - HTTP server (net/http, listen on :8888)
  - Domain → zone config lookup from Redis
  - 3-layer cache: in-process LRU → Redis → origin forward
  - Cache key construction with query param normalization
  - Cache-Control, ETag, If-None-Match handling
  - gzip compression (skip brotli until Month 4)
  - `X-RivoCloud-Cache` header (HIT/MISS/STALE)
- Implement CDN Service:
  - POST /zones (create zone with origin URL)
  - GET /zones, GET /zones/:id
  - Zone config publication to Redis on create/update
- Dashboard: Zone creation form, zone list, zone detail (basic)
- NATS setup: basic pub/sub working between CDN Service and Edge Proxy

**Deliverable:** `curl -H "Host: {zone-slug}.cdn.Rivocloud.dev" http://localhost:8888/any/path` — response served from origin, cached in Redis on second request.

### Month 3 — Storage + Custom Domains

**Goal:** Object storage working. Custom domains with TLS.

**Tasks:**

- Implement Storage Service:
  - POST /buckets, GET /buckets
  - POST /buckets/:id/objects/upload → presigned MinIO URL
  - MinIO webhook handler: object.uploaded → update metadata
  - GET /buckets/:id/objects/:key (metadata only)
  - DELETE /buckets/:id/objects/:key
- Configure Traefik with Redis provider for dynamic domain routing
- Implement CDN Service: domain management
  - POST /zones/:id/domains → write to Traefik Redis config
  - DNS verification polling (30-second interval in Scheduler)
  - SSL status tracking
- Edge proxy: serve objects from MinIO for push zones
- Dashboard: Storage tab (bucket list, object browser), domain management UI

**Deliverable:** Upload a file to a bucket, serve it via CDN URL. Add a custom domain to a zone with automatic TLS.

### Month 4 — Cache Rules + Invalidation

**Goal:** Complete cache management. Production-quality CDN behavior.

**Tasks:**

- Cache rules engine in Edge Proxy:
  - Glob pattern matching against request path
  - Per-rule TTL, browser TTL, bypass
  - Query string mode (strip_all, whitelist, include_all)
  - Priority ordering
- Cache invalidation:
  - POST /zones/:id/cache/invalidate → NATS publish
  - Edge proxy NATS subscriber: purge matching keys
  - Invalidation status tracking in PostgreSQL
- Add brotli compression support
- Range request handling in edge proxy
- stale-while-revalidate and stale-if-error support
- Signed URLs:
  - Storage Service: POST /buckets/:id/objects/:key/sign
  - Edge Proxy: verify HMAC signature on signed URLs
- Dashboard: Cache rules UI (create, drag-to-reorder), invalidation form

**Deliverable:** Full cache lifecycle working. Custom rules per zone. One-click cache purge.

### Month 5 — Analytics

**Goal:** Real-time analytics visible in dashboard.

**Tasks:**

- Edge proxy: emit analytics events to NATS (`edge.request` topic)
- Analytics Service:
  - NATS subscriber: batch-insert to ClickHouse (1,000 events or 5 seconds)
  - GET /analytics/bandwidth, /requests, /cache, /geography, /latency
  - ClickHouse queries with proper indexes
- Scheduler: hourly rollup computation (populate `bandwidth_hourly` table)
- Dashboard: Analytics page with charts (Recharts):
  - Bandwidth over time (area chart)
  - Cache hit ratio (gauge + time series)
  - Requests by country (choropleth map or table)
  - P95 latency time series
  - Status code distribution (pie chart)

**Deliverable:** Real-time analytics dashboard with at-a-glance metrics for any zone.

### Month 6 — RBAC, Audit, Webhooks

**Goal:** Production security posture. Ready for beta users.

**Tasks:**

- Full RBAC implementation: Owner/Admin/Developer/Viewer roles
- API key permission scopes enforced in every service
- Audit logging interceptor across all services
- Rate limiting middleware (Redis sliding window)
- Notification Service:
  - Email: registration, domain verified, usage alert
  - Customer webhooks: object.uploaded, cache.invalidated
- Dashboard: Settings page (members, API keys, webhook config)

**Deliverable:** Multi-tenant secure platform. Audit logs visible in dashboard.

### Month 7 — Billing

**Goal:** First paying customer possible.

**Tasks:**

- Billing Service:
  - Stripe Customer + Subscription creation
  - Stripe Checkout Session (plan upgrade flow)
  - Stripe webhook handler (payment success, failure, cancellation)
  - Usage metering: read from ClickHouse daily rollup
  - Plan limit enforcement in CDN Service (check billing status before zone operations)
- Dashboard: Billing page (current plan, usage bars, invoice list, upgrade button)
- Stripe Customer Portal integration (self-serve plan management)

**Deliverable:** Stripe-powered subscription billing. Plans enforced. Invoices generated automatically.

### Month 8 — First Real Edge Node

**Goal:** Real distributed CDN with a PoP in a different datacenter from control plane.

**Tasks:**

- Provision first Hetzner CX21 (Nuremberg, Germany)
- Ansible playbook: install Docker, deploy edge-proxy + Redis
- NATS JetStream cluster: connect Hetzner edge to Oracle control plane
- Edge proxy bootstrap: connect to NATS, fetch all zone configs on startup
- DNS: add Hetzner node IP to `edge.Rivocloud.dev` GeoDNS (route EU traffic to Nuremberg)
- Prometheus: scrape edge node metrics from Oracle Prometheus
- Load test: k6 simulation of 1,000 concurrent users

**Deliverable:** Real CDN with two physical locations. EU traffic served from Nuremberg.

### Month 9 — Production Hardening

**Goal:** Kubernetes, observability, performance. Ready for public beta.

**Tasks:**

- Kubernetes migration: deploy all services to k3s on Oracle
- PgBouncer for PostgreSQL connection pooling
- Redis Sentinel for HA
- MinIO distributed mode (4-PV erasure coding)
- ArgoCD GitOps setup
- Full Grafana dashboard: all services, edge nodes, PostgreSQL, Redis, MinIO
- Alertmanager rules: high error rate, high latency, low disk space, cert expiry
- Load testing: k6 baseline for all critical paths
- Graceful shutdown verification: all services

**Deliverable:** Production-grade infrastructure. SLO monitoring in place.

### Month 10 — Public Beta Launch

**Goal:** Real external users. Product-market fit feedback loop.

**Tasks:**

- Landing page (marketing site, separate Next.js app or static site)
- Documentation site (Mintlify or Nextra): quickstart, API reference, SDK docs
- JavaScript SDK v0.1: CDN zone management, storage upload, cache invalidation
- CLI v0.1: `Rivocloud zones list`, `Rivocloud cache invalidate`, `Rivocloud upload`
- Onboarding flow: first zone creation with guided setup
- Status page (BetterUptime or self-hosted)
- Community: Discord server, GitHub Discussions
- Announce: Product Hunt, Hacker News, Twitter/X

**Deliverable:** RivoCloud public beta. Real external users. Feedback loop active.

---

## 11. Development Order

The exact sequence to build RivoCloud, with rationale. This order minimizes wasted work by building foundations before dependents.

```
1. ── INFRASTRUCTURE FOUNDATION ──────────────────────────────────

   1.1  Monorepo scaffolding
        Why: everything else lives here
        Output: pnpm workspaces, Turborepo, go.work, Docker Compose

   1.2  Docker Compose: postgres + redis + minio + nats + clickhouse + traefik
        Why: services cannot run without infrastructure
        Output: `docker compose up` → all infra running locally

   1.3  Prisma schema + initial migration
        Why: the schema is the contract; build it before services consume it
        Output: all tables from Section 6 created in PostgreSQL

   1.4  CI pipeline (GitHub Actions): lint, typecheck, test
        Why: code quality gates before any real code is written
        Output: PR checks passing on an empty repo

2. ── IDENTITY SERVICE ────────────────────────────────────────────

   2.1  Auth: register, login, refresh, logout
        Why: every other service needs auth to validate requests
        Depends: Prisma schema (users), Redis (sessions)
        Output: JWT working, refresh token in Redis

   2.2  Organizations + Members
        Why: all resources are org-scoped
        Depends: 2.1
        Output: orgs, org members CRUD

   2.3  API Keys
        Why: programmatic access needed for all integrations
        Depends: 2.2
        Output: API keys created, hashed, verifiable

   2.4  Auth Guard (NestJS): JWT + API key middleware
        Why: all other services import this guard
        Depends: 2.1–2.3
        Output: shared auth guard package

3. ── GO EDGE PROXY (BASIC) ──────────────────────────────────────

   3.1  HTTP server, domain→zone config resolution (hard-coded for now)
        Why: prove the Go HTTP server works before adding caching
        Depends: Go stdlib only
        Output: request forwarded to origin, response returned to client

   3.2  Redis cache layer (L2)
        Why: caching is the core value; validate it early
        Depends: 3.1, Redis running
        Output: second request returns from Redis, X-RivoCloud-Cache: HIT

   3.3  In-process LRU cache (L1)
        Why: completes the 3-layer cache hierarchy
        Depends: 3.2
        Output: hot objects served from memory in <1ms

4. ── CDN SERVICE ────────────────────────────────────────────────

   4.1  Zone CRUD (create, read, update)
        Why: zones are the configuration container for all CDN features
        Depends: 2.4 (auth guard), Prisma schema (pull_zones)
        Output: zones created via API, stored in PostgreSQL

   4.2  Zone config publication to Redis
        Why: edge proxy reads zone config from Redis; CDN Service must write it
        Depends: 4.1, NATS running
        Output: zone created → Redis key updated → edge proxy uses new config

5. ── STORAGE SERVICE ────────────────────────────────────────────

   5.1  Bucket CRUD
        Why: container for objects
        Depends: 2.4, Prisma schema (buckets), MinIO running
        Output: buckets created, MinIO bucket created on backend

   5.2  Object upload (presigned URL flow)
        Why: core storage feature
        Depends: 5.1
        Output: client uploads directly to MinIO, metadata in PostgreSQL

   5.3  MinIO webhook → object.uploaded event
        Why: completes the upload lifecycle
        Depends: 5.2, NATS
        Output: upload complete → Storage Service notified → object status: ready

6. ── DASHBOARD (MVP) ────────────────────────────────────────────

   6.1  Auth pages: login, register
        Depends: 2.1
        Output: user can log in via browser

   6.2  Zone management UI: create zone, zone list, zone detail
        Depends: 4.1, 6.1
        Output: non-technical user can set up a CDN zone in 2 minutes

   6.3  Storage UI: bucket list, file browser, upload button
        Depends: 5.1–5.3, 6.1
        Output: user can upload a file via dashboard

7. ── NATS INVALIDATION ──────────────────────────────────────────

   7.1  Cache invalidation endpoint + NATS publish
        Why: invalidation is required for any mutable content use case
        Depends: 4.1, NATS, edge proxy running
        Output: POST /zones/:id/cache/invalidate → edge proxy purges keys

   7.2  Cache rules engine (edge proxy + CDN Service)
        Why: per-path TTL rules make RivoCloud useful for real apps
        Depends: 7.1, Prisma schema (cache_rules)
        Output: /api/* bypasses cache; /assets/* cached 7 days

8. ── CUSTOM DOMAINS + TLS ───────────────────────────────────────

   8.1  Traefik Redis provider configuration
        Depends: Traefik running, Redis
        Output: Traefik dynamically routes based on Redis config

   8.2  Domain management (CDN Service → Traefik Redis)
        Depends: 8.1, 4.1
        Output: add domain → Traefik picks it up → Let's Encrypt cert issued

   8.3  DNS verification polling (Scheduler)
        Depends: 8.2, Scheduler service
        Output: domain transitions to 'active' once DNS resolves

9. ── ANALYTICS ──────────────────────────────────────────────────

   9.1  Edge proxy: emit analytics events to NATS
        Depends: edge proxy running, NATS
        Output: every request logged as NATS event

   9.2  Analytics Service: NATS → ClickHouse ingestion
        Depends: 9.1, ClickHouse running
        Output: request events visible in ClickHouse

   9.3  Analytics Service: aggregation queries
        Depends: 9.2
        Output: GET /analytics/bandwidth returns data

   9.4  Dashboard: analytics charts
        Depends: 9.3, 6.1
        Output: real-time bandwidth and cache hit charts

10. ── SIGNED URLS ───────────────────────────────────────────────

    10.1  Storage Service: generate signed URL (HMAC-SHA256)
          Depends: 5.2
          Output: POST /objects/:key/sign returns time-limited URL

    10.2  Edge proxy: verify signed URL signature
          Depends: 10.1, edge proxy
          Output: expired or invalid signatures get 403

11. ── SECURITY + RBAC ───────────────────────────────────────────

    11.1  RBAC roles enforced in all services
          Depends: 2.4
          Output: viewer cannot create zones; developer cannot manage billing

    11.2  Audit logging interceptor
          Depends: all services
          Output: all mutations logged to audit_logs

    11.3  Rate limiting middleware
          Depends: Redis
          Output: auth endpoints limited to 10 req/min per IP

12. ── BILLING ───────────────────────────────────────────────────

    12.1  Stripe Customer + Checkout Session
          Depends: 2.2 (orgs), billing_accounts table
          Output: org can subscribe to paid plan via Stripe Checkout

    12.2  Stripe webhook handler
          Depends: 12.1
          Output: payment confirmed → plan activated in database

    12.3  Usage metering + plan limit enforcement
          Depends: 12.2, Analytics Service (usage data)
          Output: org over bandwidth limit → zones disabled until next period

13. ── KUBERNETES MIGRATION ──────────────────────────────────────

    13.1  k3s cluster on Oracle Free Tier
          Output: running Kubernetes cluster

    13.2  Migrate all services to Kubernetes
          Output: full platform running in k3s

    13.3  ArgoCD GitOps
          Output: deploy by merging to main

14. ── FIRST HETZNER EDGE NODE ───────────────────────────────────

    14.1  Provision CX21 with Ansible
          Output: Hetzner VPS running Docker

    14.2  Deploy edge-proxy + Redis
          Output: edge node handling real traffic

    14.3  NATS cluster: Hetzner ↔ Oracle
          Output: cache invalidation events reach Hetzner edge

    14.4  GeoDNS: EU traffic → Nuremberg
          Output: EU users get 20-50ms CDN response vs 100ms+

15. ── SDK + CLI ─────────────────────────────────────────────────

    15.1  JavaScript/TypeScript SDK
          Output: npm install @Rivocloud/sdk; zones.create(...)

    15.2  CLI (Go, cobra)
          Output: Rivocloud zones list, Rivocloud cache invalidate /path

16. ── PUBLIC BETA ───────────────────────────────────────────────

    16.1  Documentation site
    16.2  Landing page
    16.3  Onboarding flow polish
    16.4  Status page
    16.5  Announce
```

### Dependency Graph Summary

```
[Infrastructure] → [Identity] → [Auth Guard]
                                    ↓
[Go Edge Proxy] ←──── [CDN Service] ←── [Auth Guard]
      ↑                    ↓
   [Redis]            [Cache Rules]
   [NATS] ←──────────── [Invalidation]
      ↓
[Analytics Service] → [ClickHouse] → [Dashboard Analytics]
    
[Storage Service] → [MinIO] → [Edge Proxy (push zones)]
      ↓
[Signed URLs] → [Edge Proxy (verification)]

[Billing Service] → [Stripe] → [Plan Limits] → [CDN Service]

[Kubernetes] → [First Edge Node] → [NATS Cluster] → [Real CDN]
```

---

*End of Phase 1 CDN Engineering Design Document*
*Next document: 2026-06-29-Rivocloud-phase2-media-edd.md (to be written when Phase 1 nears completion)*
