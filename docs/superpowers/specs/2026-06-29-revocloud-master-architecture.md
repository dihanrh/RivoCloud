# RivoCloud — Master Architecture Document

**Version:** 1.0
**Date:** 2026-06-29
**Status:** Approved
**Authors:** Engineering (Staff Engineer / CTO perspective)

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Product Strategy](#2-product-strategy)
3. [High-Level System Architecture](#3-high-level-system-architecture)
4. [Scaling Strategy](#4-scaling-strategy)
5. [Technology Decisions](#5-technology-decisions)
6. [Monorepo Structure](#6-monorepo-structure)
7. [Common Architecture Mistakes](#7-common-architecture-mistakes)

---

## 1. Product Vision

### What is RivoCloud?

RivoCloud is an **edge-first cloud infrastructure platform** that starts as a CDN and evolves into a fully programmable edge platform. It sits in the gap between pure CDN providers (Bunny.net, KeyCDN) and full cloud platforms (AWS, Cloudflare), offering the developer experience of Vercel with the infrastructure depth of Cloudflare — but open-core, AI-native, and designed for the next generation of web applications.

The core insight: CDN is no longer just caching static files. Modern applications require intelligent edge infrastructure that can cache, transform, route, compute, and reason about content. RivoCloud is built for that world from day one.

### Who Are the Customers?

| Segment                                    | Description                                 | Why They Choose RivoCloud                          |
| ------------------------------------------ | ------------------------------------------- | -------------------------------------------------- |
| **Solo developers / indie hackers**  | Building SaaS, APIs, media apps             | Simple pricing, great DX, unified platform         |
| **Startups (seed → Series A)**      | Need CDN + storage + media pipeline         | Fewer vendors, lower cost than AWS CloudFront + S3 |
| **SMBs with media-heavy products**   | Video platforms, e-commerce with images     | Media pipeline + CDN in one place                  |
| **AI application builders**          | LLM apps, RAG systems, AI-generated content | Semantic caching, AI-native edge features          |
| **DevOps-forward engineering teams** | Want programmability over black-box CDNs    | Edge Functions, API Gateway, full observability    |

### What Problems Does RivoCloud Solve?

**Problem 1: Fragmentation.** A typical startup uses CloudFront (CDN) + S3 (storage) + Lambda@Edge (compute) + Imgix (images) + Mux (video). That is four vendors, four bills, four SDKs. RivoCloud unifies these into a single platform.

**Problem 2: CDN complexity.** AWS CloudFront has 200+ configuration options. Bunny.net is simpler but not programmable. Cloudflare is powerful but opinionated and proprietary. RivoCloud is designed to be simple to start and deep when needed.

**Problem 3: AI-era infrastructure gap.** Existing CDNs cache bytes, not semantics. As LLMs become standard infrastructure, applications need caches that understand meaning — RivoCloud's AI Cache layer does this at the edge.

**Problem 4: Vendor lock-in.** Cloudflare Workers use a proprietary runtime. AWS Lock-in is well-documented. RivoCloud uses open standards (WinterCG-compatible runtime, S3-compatible storage API) so workloads are portable.

### Why Choose RivoCloud Over Competitors?

| Feature          | Cloudflare            | Bunny.net   | AWS CloudFront | RivoCloud                |
| ---------------- | --------------------- | ----------- | -------------- | ------------------------ |
| CDN              | Excellent             | Good        | Good           | Good → Excellent        |
| Object Storage   | R2 (S3-compat)        | B2          | S3             | S3-compatible            |
| Edge Functions   | Workers (proprietary) | None        | Lambda@Edge    | WinterCG standard        |
| Media Processing | Images only           | None        | None           | Images + Video           |
| AI Cache         | None                  | None        | None           | Semantic cache           |
| Self-hostable    | No                    | No          | No             | Yes (open core)          |
| Pricing model    | Opaque                | Transparent | Complex        | Transparent, usage-based |
| DX / SDK         | Good                  | Mediocre    | Poor           | First-class              |
| Open source      | No                    | No          | No             | Core is open             |

### Long-Term Vision

RivoCloud becomes the **infrastructure layer for AI-native applications**. Not just a CDN that caches static assets, but a programmable edge that:

- Understands the semantic content of what it caches (AI Cache)
- Runs business logic at the edge without cold starts (Edge Functions)
- Transforms and optimizes media intelligently (Media Pipeline)
- Routes API traffic with awareness of downstream AI service costs (API Gateway)
- Observes every byte of traffic with real-time analytics (Analytics)

In five years, RivoCloud is the platform that AI-first startups choose the same way Rails-era startups chose Heroku: a single platform that removes infrastructure complexity so engineering teams can focus on their product.

---

## 2. Product Strategy

### MVP — "Make it work" (Months 1–3)

**Goal:** Prove the core CDN loop works end-to-end on a single machine.

| Feature                             | Rationale                                                          |
| ----------------------------------- | ------------------------------------------------------------------ |
| Origin pull CDN                     | The fundamental CDN primitive — without this nothing else matters |
| Redis cache layer                   | Proves the caching architecture before adding complexity           |
| Single organization, single project | No multi-tenancy yet — keep auth surface minimal                  |
| Basic REST API                      | Needed to automate anything                                        |
| Minimal dashboard (Next.js)         | Validate the UX before building more UI                            |
| Docker Compose deployment           | Zero ops burden while building core features                       |
| MinIO for object storage            | Unblocks storage features without building a storage engine        |

**What is explicitly excluded from MVP:**
Custom domains, Let's Encrypt, cache rules engine, analytics, billing, media processing, signed URLs, multi-tenancy. These are all real features that would be built before v1.0, but adding them to MVP adds weeks of work that won't validate the core CDN concept.

### Version 0.5 — "Make it right" (Months 4–6)

**Goal:** Multi-tenant, production-safe, observable. The first version a real user could trust.

| Feature                                   | Rationale                                     |
| ----------------------------------------- | --------------------------------------------- |
| Multi-tenancy (orgs, projects)            | Required to have more than one customer       |
| Custom domains + Let's Encrypt            | Real CDNs serve traffic on customer domains   |
| API keys with RBAC                        | Security foundation for everything else       |
| Cache rules engine                        | Differentiates RivoCloud from dumb proxies    |
| Cache analytics (hits, misses, bandwidth) | Customers need to see value                   |
| Cache invalidation by path/tag            | Required for any dynamic application          |
| Kubernetes deployment (k3s)               | Validates the K8s path before production load |

### Version 1.0 — "Make it scale" (Months 7–12)

**Goal:** First paying customers, real edge nodes, production SLA.

| Feature                             | Rationale                                      |
| ----------------------------------- | ---------------------------------------------- |
| Multi-region edge nodes (3+ PoPs)   | Makes it a real CDN, not a reverse proxy       |
| Origin push (pre-populated storage) | Enables asset-heavy use cases                  |
| Signed URLs                         | Security for private content delivery          |
| Billing integration (Stripe)        | Monetization — required for sustainability    |
| SLA monitoring + alerting           | Required to promise uptime to paying customers |
| Public beta                         | External users find bugs you never will        |
| SDK (JavaScript)                    | DX is a product differentiator                 |
| CLI                                 | Power users need CLI                           |

### Future Roadmap

| Phase          | Timeline     | Key Additions                                                                 |
| -------------- | ------------ | ----------------------------------------------------------------------------- |
| Phase 2: Media | Year 2 Q1-Q2 | Image optimization, WebP/AVIF, video transcoding, adaptive streaming          |
| Phase 3: Edge  | Year 2 Q3-Q4 | Edge Functions (WinterCG), API Gateway, rate limiting, real-time analytics    |
| Phase 4: AI    | Year 3       | Semantic cache, predictive warming, AI image processing, traffic optimization |

Each phase builds on the prior. Edge Functions are impossible without a stable CDN and storage layer. AI Cache requires Edge Functions and a stable analytics pipeline. The order is not arbitrary — it reflects hard dependencies.

---

## 3. High-Level System Architecture

### Architectural Philosophy

RivoCloud separates the **control plane** (configuration, management, billing) from the **data plane** (serving traffic at the edge). This is how every serious CDN and cloud platform is built:

- **Control plane:** correctness over performance. Written in TypeScript/NestJS. Handles configuration, auth, billing, analytics aggregation. Runs on Oracle Cloud.
- **Data plane:** performance over correctness. Written in Go. Handles every byte of customer traffic. Runs on Hetzner edge nodes and Oracle PoP.

These two planes must be **decoupled** — edge nodes cannot make synchronous calls to the control plane for every request. Edge nodes load their configuration at startup and subscribe to invalidation events via NATS. The control plane is never in the hot path.

### System Diagram

```
                        ┌─────────────────────────────────────┐
                        │           CUSTOMERS / USERS          │
                        └──────────────┬──────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────────┐
                    │              DNS (Anycast)               │
                    └──────────────────┬──────────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
   ┌──────▼──────┐             ┌───────▼──────┐             ┌──────▼──────┐
   │  EDGE NODE  │             │  EDGE NODE   │             │  EDGE NODE  │
   │ Nuremberg   │             │   Ashburn    │             │  Singapore  │
   │  (Hetzner)  │             │   (Hetzner)  │             │  (Hetzner)  │
   │             │             │              │             │             │
   │ ┌─────────┐ │             │  ┌─────────┐ │             │ ┌─────────┐ │
   │ │Go Edge  │ │             │  │Go Edge  │ │             │ │Go Edge  │ │
   │ │ Proxy   │ │             │  │ Proxy   │ │             │ │ Proxy   │ │
   │ └────┬────┘ │             │  └────┬────┘ │             │ └────┬────┘ │
   │      │      │             │       │      │             │      │      │
   │ ┌────▼────┐ │             │  ┌────▼────┐ │             │ ┌────▼────┐ │
   │ │  Redis  │ │             │  │  Redis  │ │             │ │  Redis  │ │
   │ │  Cache  │ │             │  │  Cache  │ │             │ │  Cache  │ │
   │ └─────────┘ │             │  └─────────┘ │             │ └─────────┘ │
   └──────┬──────┘             └───────┬──────┘             └──────┬──────┘
          │                            │                            │
          └────────────────────────────┼────────────────────────────┘
                                       │  NATS (pub/sub)
                                       │  Cache Invalidation Events
                                       │  Config Sync
                        ┌──────────────▼──────────────────────┐
                        │          CONTROL PLANE               │
                        │        (Oracle Cloud ARM)            │
                        │                                      │
                        │  ┌──────────┐   ┌───────────────┐   │
                        │  │Traefik   │   │  Identity     │   │
                        │  │API GW    │   │  Service      │   │
                        │  └──────────┘   └───────────────┘   │
                        │  ┌──────────┐   ┌───────────────┐   │
                        │  │CDN       │   │  Storage      │   │
                        │  │Service   │   │  Service      │   │
                        │  └──────────┘   └───────────────┘   │
                        │  ┌──────────┐   ┌───────────────┐   │
                        │  │Analytics │   │  Billing      │   │
                        │  │Service   │   │  Service      │   │
                        │  └──────────┘   └───────────────┘   │
                        │  ┌──────────┐   ┌───────────────┐   │
                        │  │Notif.    │   │  Scheduler    │   │
                        │  │Service   │   │               │   │
                        │  └──────────┘   └───────────────┘   │
                        │                                      │
                        │  ┌──────────────────────────────┐   │
                        │  │       STORAGE LAYER           │   │
                        │  │  PostgreSQL │ Redis │ MinIO   │   │
                        │  │  ClickHouse │ NATS           │   │
                        │  └──────────────────────────────┘   │
                        └─────────────────────────────────────┘
                                       │
                        ┌──────────────▼──────────────────────┐
                        │         DASHBOARD (Next.js)          │
                        │     dashboard.Rivocloud.dev          │
                        └─────────────────────────────────────┘
```

### Control Plane Components

| Component            | Runtime      | Responsibility                                        |
| -------------------- | ------------ | ----------------------------------------------------- |
| Traefik              | Go (managed) | API gateway, TLS termination, rate limiting, routing  |
| Identity Service     | NestJS       | Auth, users, organizations, API keys, sessions        |
| CDN Service          | NestJS       | Pull zones, custom domains, cache rules, invalidation |
| Storage Service      | NestJS       | Bucket management, object metadata, presigned URLs    |
| Analytics Service    | NestJS       | Event ingestion, aggregation queries, reporting       |
| Billing Service      | NestJS       | Usage metering, Stripe integration, invoicing         |
| Notification Service | NestJS       | Email, webhooks, alerts                               |
| Scheduler            | NestJS       | Cron jobs, lifecycle policies, cache warming          |
| Dashboard            | Next.js      | Web UI                                                |

### Data Plane Components

| Component      | Runtime             | Responsibility                                           |
| -------------- | ------------------- | -------------------------------------------------------- |
| Edge Proxy     | Go                  | HTTP/HTTPS proxy, cache lookup, cache write, compression |
| Local Redis    | Redis               | Per-PoP edge cache (L2)                                  |
| In-process LRU | Go (sync.Map + LRU) | Per-process hot cache (L1)                               |

### Storage Layer

| Component        | Purpose                                       | Technology          |
| ---------------- | --------------------------------------------- | ------------------- |
| Metadata DB      | Users, configs, schemas, billing              | PostgreSQL 16       |
| Cache & Sessions | JWT blacklist, rate limits, edge config cache | Redis 7             |
| Object Storage   | Files, media, CDN origin content              | MinIO (distributed) |
| Analytics DB     | Time-series request logs, metrics             | ClickHouse          |
| Message Bus      | Cache invalidation, service events            | NATS JetStream      |

### Request Flow — CDN Cache Hit

```
Client → DNS → Edge PoP
  Edge Proxy
    1. Check in-process LRU (L1 cache) → HIT → return response (sub-millisecond)
    2. Check local Redis (L2 cache) → HIT → populate L1, return response (<1ms)
    3. Check MinIO (origin storage) → HIT → populate L2 + L1, return response (<50ms)
    4. MISS → forward to customer origin → cache response → return
```

### Request Flow — Cache Invalidation

```
Dashboard/API → CDN Service → PostgreSQL (record invalidation)
                            → NATS: publish "cache.invalidate" event
                              ↓
                All edge nodes subscribed to NATS receive event
                Each edge proxy:
                  → Purge matching keys from local Redis
                  → Purge matching keys from in-process LRU
                  → Acknowledge via NATS reply
```

---

## 4. Scaling Strategy

This is the complete evolution path from zero to global SaaS. Each stage has an explicit trigger (what forces the migration) and a cost estimate.

### Stage 1: Single Node / Docker Compose (Months 1–3)

```
┌────────────────────────────────────┐
│  Developer Laptop / Local Machine  │
│                                    │
│  docker compose up                 │
│  All services: 1 process each      │
│  PostgreSQL, Redis, MinIO, NATS    │
│  ClickHouse                        │
└────────────────────────────────────┘
```

**Cost:** €0
**Capacity:** Development only, no external traffic
**Trigger to next stage:** Ready to accept real users

### Stage 2: Single VPS — Oracle Free Tier (Months 4–6)

```
┌────────────────────────────────────────────┐
│  Oracle Cloud ARM (4 cores, 24GB RAM)       │
│  Oracle Always Free — €0/month             │
│                                            │
│  Docker Compose (same as local)            │
│  Traefik with Let's Encrypt               │
│  All services containerized               │
│  MinIO single-node mode                   │
│  Real domain: api.Rivocloud.dev           │
└────────────────────────────────────────────┘
```

**Cost:** €0/month (Oracle Free Tier) + domain
**Capacity:** ~100 concurrent users, ~10TB/month storage
**Trigger to next stage:** First paying customers, need HA

### Stage 3: Basic Kubernetes — k3s on Oracle (Months 7–9)

```
┌─────────────────────────────────────────────────────┐
│  Oracle Cloud (2× ARM instances, Free Tier)         │
│                                                     │
│  k3s cluster (1 control node, 1 worker)            │
│  Namespaces: Rivocloud-control, Rivocloud-infra     │
│                                                     │
│  Control: all NestJS services as Deployments        │
│  Infra: PostgreSQL StatefulSet, Redis StatefulSet   │
│         MinIO StatefulSet (4 PVs for erasure)       │
│         ClickHouse StatefulSet                      │
│  HPA on: analytics-service, storage-service         │
│                                                     │
│  + First Hetzner edge node (CX21, €5/month)        │
│    Running: edge-proxy + local Redis                │
└─────────────────────────────────────────────────────┘
```

**Cost:** €0 (Oracle) + €5 (Hetzner edge) = €5/month
**Capacity:** ~1,000 concurrent users, real CDN edge
**Trigger to next stage:** Traffic growth requires more edge nodes

### Stage 4: Multi-Edge Kubernetes (Months 10–12)

```
┌─────────────────────────────────────────────────────┐
│  Control Plane (Oracle, k3s)                        │
│  PostgreSQL primary + 1 read replica                │
│  Redis Sentinel (3 nodes)                          │
│  MinIO distributed (4-node erasure coding)          │
│  ClickHouse cluster (2 nodes)                       │
└─────────────────────────────────────────────────────┘
          │ NATS JetStream cluster
          │
┌─────────┴──────────────────────────────────────────┐
│  Edge PoPs (Hetzner)                               │
│                                                    │
│  Nuremberg (CX21)  Helsinki (CX21)  Ashburn (CX21) │
│  edge-proxy × 2   edge-proxy × 2   edge-proxy × 2  │
│  Redis (local)    Redis (local)    Redis (local)   │
└────────────────────────────────────────────────────┘
```

**Cost:** ~€50-100/month
**Capacity:** ~50,000 users, 3 PoPs, ~100TB/month bandwidth
**Trigger to next stage:** Revenue justifies more PoPs + managed K8s

### Stage 5: Multi-Region Production (Year 2)

```
Control Plane: Oracle Cloud (managed Kubernetes or Hetzner K3s with external DBaaS)
Database: Managed PostgreSQL (Aiven or Supabase) — removes operational burden
Redis: Managed Redis (Upstash) — global replication

Edge PoPs (Hetzner):
  EU: Nuremberg, Helsinki, Warsaw
  NA: Ashburn, Hillsboro
  APAC: Singapore, Tokyo
  
Anycast routing: Cloudflare for DNS or own BGP (advanced)
NATS: 3-node JetStream cluster, control plane + edge subscribe
ClickHouse: 3-node cluster with replication
```

**Cost:** ~€500-1,500/month
**Capacity:** 100,000+ users, global traffic distribution
**Trigger to next stage:** Revenue > €10k MRR

### Stage 6: Global Commercial SaaS (Year 3+)

- Own BGP Anycast network (via Hetzner or Vultr BGP)
- 15+ PoP locations across all continents
- Dedicated bare metal for high-volume edge nodes
- Custom edge runtime for Edge Functions
- Global ClickHouse cluster for real-time analytics
- Dedicated infrastructure team

---

## 5. Technology Decisions

Every technology decision below includes the trade-offs and a clear recommendation. Revisit these as the project grows; what is correct for Month 1 may not be correct for Year 3.

---

### 5.1 Data Plane Runtime: Go vs Node.js vs Rust

|                    | Go                                            | Node.js                                | Rust                  |
| ------------------ | --------------------------------------------- | -------------------------------------- | --------------------- |
| Performance        | Excellent (goroutines, no GC pauses at scale) | Good (event loop, but single-threaded) | Exceptional (zero GC) |
| Concurrency model  | Goroutines (M:N threading)                    | Event loop (single thread)             | Async (tokio)         |
| Memory footprint   | Low (~10MB idle)                              | Medium (~50MB idle)                    | Very low              |
| CDN ecosystem      | Caddy, Traefik, MinIO all written in Go       | Good HTTP libraries                    | Pingora (Cloudflare)  |
| Learning curve     | Moderate                                      | Low (you know it)                      | High                  |
| Binary deployment  | Single binary, no runtime                     | Needs Node.js installed                | Single binary         |
| Production ceiling | 100k+ req/s per node                          | 10-20k req/s per node                  | 500k+ req/s per node  |

**Recommendation: Go for data plane.**
Rust would be the ultimate performance choice (it's what Cloudflare uses for Pingora), but the productivity cost is too high for a solo developer. Go gives 90% of Rust's performance with far better ergonomics. The Go standard library's `net/http` package is production-grade. The entire CDN ecosystem (Caddy, Traefik, MinIO, NATS, k3s) is written in Go, which means excellent libraries and reference implementations.

**Recommendation: TypeScript/NestJS for control plane.**
NestJS's decorator-based architecture, built-in dependency injection, Guards for auth, Interceptors for logging, and OpenAPI generation make it the right choice for building 8+ microservices quickly and consistently. Your existing NestJS experience eliminates the learning curve on the control plane where it matters least.

---

### 5.2 Cache Store: Redis vs Dragonfly vs KeyDB

|                      | Redis 7                        | Dragonfly                | KeyDB                 |
| -------------------- | ------------------------------ | ------------------------ | --------------------- |
| Maturity             | Very high                      | Medium (2022)            | Medium                |
| API compatibility    | N/A (reference)                | 99% Redis-compatible     | 100% Redis-compatible |
| Performance          | Excellent                      | 25× faster (claims)     | 5× faster (claims)   |
| Multi-threading      | No (single-threaded)           | Yes                      | Yes                   |
| Memory efficiency    | Good                           | Better (DASH hash table) | Good                  |
| Cluster mode         | Redis Cluster (complex)        | Replication only         | Active replication    |
| Tooling / monitoring | Excellent (RedisInsight, etc.) | Limited                  | Limited               |
| Production risk      | Very low                       | Medium                   | Medium                |

**Recommendation: Redis 7.**
Dragonfly's performance claims are impressive in benchmarks, but Redis's operational maturity, tooling, monitoring, documentation, and community are unmatched. For a CDN edge cache, Redis is fast enough — the bottleneck at scale will be network I/O and origin latency, not Redis throughput. Revisit Dragonfly if Redis becomes a measured bottleneck after the platform reaches serious scale.

---

### 5.3 Message Bus: RabbitMQ vs Kafka vs NATS

|                        | RabbitMQ         | Kafka                         | NATS JetStream                   |
| ---------------------- | ---------------- | ----------------------------- | -------------------------------- |
| Primary use case       | Task queues, RPC | High-throughput log streaming | Lightweight pub/sub + streaming  |
| Throughput             | Good             | Exceptional                   | Excellent                        |
| Latency                | Low              | Medium (batch-oriented)       | Very low                         |
| Operational complexity | Medium           | High (ZooKeeper/Kraft)        | Low                              |
| Persistence            | Queue-based      | Log-based (excellent)         | Log-based                        |
| Written in             | Erlang           | Java/Scala                    | Go                               |
| Edge node deployment   | Heavy            | Too heavy                     | Lightweight (Go binary)          |
| CDN use case fit       | Medium           | Good for analytics pipeline   | Excellent for cache invalidation |

**Recommendation: NATS JetStream.**
The killer advantage of NATS for RivoCloud: it is a single Go binary, it runs on an edge node with 4GB RAM, and it provides exactly the pub/sub + at-least-once delivery semantics needed for cache invalidation events. Kafka is the right choice when you have a dedicated data engineering team running a large-scale analytics pipeline. For a startup building its first CDN, NATS is the right call. Use NATS JetStream for event persistence. If the analytics pipeline outgrows NATS, add Kafka specifically for that path — but not before.

---

### 5.4 Metadata Database: PostgreSQL vs CockroachDB vs PlanetScale

|                          | PostgreSQL 16                 | CockroachDB      | PlanetScale    |
| ------------------------ | ----------------------------- | ---------------- | -------------- |
| SQL compliance           | Excellent                     | Very good        | Good (MySQL)   |
| Global distribution      | Requires setup (replicas)     | Built-in         | Built-in       |
| Operational complexity   | Low (single instance)         | High             | Managed (SaaS) |
| Cost                     | Free (self-hosted)            | License or cloud | Paid           |
| Ecosystem                | Exceptional (Prisma, tooling) | Good             | Good           |
| JSONB / arrays           | Excellent                     | Good             | No             |
| Full-text search         | Built-in                      | Limited          | No             |
| Horizontal write scaling | Read replicas + Citus         | Built-in         | Built-in       |

**Recommendation: PostgreSQL 16.**
CockroachDB is the right database for a globally-distributed multi-master write system. RivoCloud's control plane is not that. Configuration data (zones, rules, users, billing) is written rarely and read often. A primary PostgreSQL with one read replica handles this comfortably to millions of users. PostgreSQL's JSONB column is critical for storing cache rules, lifecycle policies, and permission scopes without schema proliferation. Add Citus (horizontal sharding extension) only if write throughput becomes a measured bottleneck at scale.

---

### 5.5 Object Storage: MinIO vs Ceph vs Custom

|                        | MinIO                        | Ceph                   | Custom         |
| ---------------------- | ---------------------------- | ---------------------- | -------------- |
| S3 API compatibility   | Full                         | Good                   | Your design    |
| Erasure coding         | Yes (built-in)               | Yes                    | Build yourself |
| Operational complexity | Low                          | Very high              | Very high      |
| Performance            | Excellent                    | Good                   | Unknown        |
| Written in             | Go                           | C++                    | Go (RivoCloud) |
| Single binary          | Yes                          | No                     | Yes            |
| Open source            | AGPL-3                       | LGPL                   | MIT            |
| Production use         | Massive (ML pipelines, CDNs) | Large storage clusters | N/A            |

**Recommendation: MinIO now, evaluate custom engine at Phase 3.**
MinIO is used by Cloudflare, Adobe, and hundreds of enterprises as the storage backbone. Building a custom object store is a multi-year engineering effort. RivoCloud's storage API (RivoCloud Storage Service) sits on top of MinIO — if MinIO ever needs to be replaced, only the storage backend changes, not the API. Start with MinIO; learn from its design; consider a custom engine when you have specific access patterns that MinIO handles poorly (likely never).

---

### 5.6 Ingress / Proxy: Nginx vs Envoy vs Traefik

For the **control plane ingress** (routing external traffic to NestJS services):

|                          | Nginx               | Envoy             | Traefik              |
| ------------------------ | ------------------- | ----------------- | -------------------- |
| Auto TLS (Let's Encrypt) | Manual (certbot)    | Manual            | Automatic            |
| Docker / K8s discovery   | Manual config       | xDS API (complex) | Native automatic     |
| Configuration            | nginx.conf (static) | YAML (complex)    | YAML / Docker labels |
| Performance              | Excellent           | Excellent         | Very good            |
| Admin API                | Limited             | Excellent         | Good                 |
| Learning curve           | Medium              | High              | Low                  |

**Recommendation: Traefik for control plane ingress.**
Traefik's automatic Let's Encrypt and Docker/Kubernetes-native service discovery eliminate entire categories of ops work. When you add a new NestJS service, Traefik discovers it automatically. There is no nginx.conf to maintain. Traefik's performance is more than sufficient for control plane traffic. Nginx or Envoy would be legitimate choices if you needed very fine-grained load-balancing control or a full service mesh.

For the **data plane** (the Go edge proxy): do not use Traefik or Nginx. The edge proxy must be a custom Go program to implement cache-key logic, ETag handling, signed URL verification, range request handling, and cache policy enforcement. These are impossible to implement correctly in an off-the-shelf proxy configuration.

---

### 5.7 Analytics Database: ClickHouse vs Elasticsearch vs TimescaleDB

|                            | ClickHouse                 | Elasticsearch                | TimescaleDB                 |
| -------------------------- | -------------------------- | ---------------------------- | --------------------------- |
| Query type                 | OLAP (aggregations, scans) | Full-text search + analytics | Time-series SQL             |
| Ingestion throughput       | Very high                  | High                         | Medium                      |
| Storage compression        | Excellent (10:1 ratio)     | Medium                       | Good                        |
| Query speed (aggregations) | Exceptional                | Good                         | Good                        |
| Memory requirements        | Low-medium                 | High                         | Medium                      |
| SQL support                | Full                       | Limited                      | Full (PostgreSQL extension) |
| Operational complexity     | Medium                     | High                         | Low                         |
| Used by CDNs               | Cloudflare, ClickHouse.com | Yes                          | Less common for CDN         |

**Recommendation: ClickHouse.**
Cloudflare processes 10 trillion requests per day through ClickHouse. For CDN analytics (bandwidth per zone, cache hit ratio, requests by country, latency percentiles over time), ClickHouse's columnar storage and vectorized query engine are orders of magnitude faster than Elasticsearch at a fraction of the cost. TimescaleDB is excellent but is an extension on PostgreSQL — ClickHouse is purpose-built for this workload. Deploy a single ClickHouse instance for Phase 1; it will handle billions of rows before needing horizontal scaling.

---

### 5.8 Observability: Prometheus vs OpenTelemetry

These are not competing technologies — they are complementary layers.

| Layer               | Technology        | Role                                          |
| ------------------- | ----------------- | --------------------------------------------- |
| Instrumentation     | OpenTelemetry SDK | Emit metrics, traces, logs from every service |
| Metrics storage     | Prometheus        | Scrape OTel metrics, store time-series        |
| Log aggregation     | Loki              | Aggregate structured logs from all services   |
| Distributed tracing | Tempo             | Store and query distributed traces            |
| Visualization       | Grafana           | Single UI for metrics, logs, and traces       |
| Alerting            | Alertmanager      | PagerDuty/email on SLO breaches               |

**Recommendation: OpenTelemetry for instrumentation everywhere; Prometheus + Loki + Tempo for storage; Grafana for visualization.**
Using OTel SDK means your instrumentation is vendor-neutral. You can swap Prometheus for VictoriaMetrics later without changing a line of application code. The PLT stack (Prometheus + Loki + Tempo) is the open-source standard and integrates natively with Grafana. All four run in Docker Compose from day one.

---

## 6. Monorepo Structure

### Package Manager and Build System

- **Package manager:** pnpm workspaces (faster than npm, correct hoisting, monorepo-native)
- **Build orchestration:** Turborepo (caches builds, runs tasks in dependency order, incremental)
- **Go workspace:** `go.work` file at repo root for Go modules
- **Container builds:** Docker BuildKit with layer caching

### Directory Structure

```
Rivocloud/
│
├── apps/                          # Deployable applications
│   ├── edge-proxy/                # Go — hot path CDN proxy
│   │   ├── cmd/proxy/main.go
│   │   ├── internal/
│   │   │   ├── cache/             # Redis + LRU cache logic
│   │   │   ├── proxy/             # HTTP proxy, origin forwarding
│   │   │   ├── middleware/        # Auth, rate limit, compression
│   │   │   └── config/            # Zone config loader
│   │   ├── Dockerfile
│   │   └── go.mod
│   │
│   ├── identity-service/          # NestJS — auth, users, orgs, API keys
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   ├── users/
│   │   │   ├── organizations/
│   │   │   └── api-keys/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── cdn-service/               # NestJS — zones, domains, cache rules
│   │   ├── src/
│   │   │   ├── zones/
│   │   │   ├── domains/
│   │   │   ├── cache-rules/
│   │   │   └── invalidation/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── storage-service/           # NestJS — buckets, objects, presigned URLs
│   │   ├── src/
│   │   │   ├── buckets/
│   │   │   ├── objects/
│   │   │   └── signed-urls/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── analytics-service/         # NestJS — ingestion, aggregation, reporting
│   │   ├── src/
│   │   │   ├── ingestion/
│   │   │   ├── aggregation/
│   │   │   └── reports/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── billing-service/           # NestJS — Stripe, usage, invoices
│   │   ├── src/
│   │   │   ├── stripe/
│   │   │   ├── usage/
│   │   │   └── invoices/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── notification-service/      # NestJS — email, webhooks
│   │   ├── src/
│   │   │   ├── email/
│   │   │   └── webhooks/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── scheduler/                 # NestJS — cron, lifecycle, cache warming
│   │   ├── src/
│   │   │   ├── lifecycle/
│   │   │   ├── warming/
│   │   │   └── reports/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── dashboard/                 # Next.js — web UI
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   └── lib/
│       ├── Dockerfile
│       └── package.json
│
├── packages/                      # Shared libraries (not deployed alone)
│   ├── db/                        # Prisma schema + migrations + client
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── src/index.ts
│   ├── shared-types/              # TypeScript interfaces shared across services
│   │   └── src/
│   ├── shared-utils/              # Common helpers (pagination, errors, validation)
│   │   └── src/
│   ├── events/                    # NATS event schemas (TypeScript + Go generated)
│   │   └── src/
│   └── config/                    # Shared env validation (zod schemas)
│       └── src/
│
├── sdks/                          # Customer-facing SDKs
│   ├── js/                        # TypeScript/JavaScript SDK
│   │   ├── src/
│   │   │   ├── cdn.ts
│   │   │   ├── storage.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── go/                        # Go SDK
│   │   ├── cdn.go
│   │   ├── storage.go
│   │   └── go.mod
│   └── cli/                       # RivoCloud CLI (Go, cobra)
│       ├── cmd/
│       ├── internal/
│       └── go.mod
│
├── infrastructure/
│   ├── docker/                    # Per-service Dockerfiles (if not co-located)
│   ├── compose/
│   │   ├── docker-compose.yml     # Full local dev stack
│   │   ├── docker-compose.edge.yml # Edge node only
│   │   └── docker-compose.infra.yml # Infrastructure services only
│   ├── kubernetes/
│   │   ├── namespaces/
│   │   ├── control-plane/         # NestJS service manifests
│   │   ├── data-plane/            # Edge proxy manifests
│   │   ├── infrastructure/        # PostgreSQL, Redis, MinIO StatefulSets
│   │   └── monitoring/            # Prometheus, Grafana, Loki, Tempo
│   ├── terraform/
│   │   ├── oracle/                # Oracle Cloud ARM instances
│   │   ├── hetzner/               # Edge node provisioning
│   │   └── dns/                   # DNS records
│   └── ansible/
│       ├── playbooks/
│       │   ├── edge-node.yml      # Provision Hetzner edge node
│       │   └── control-plane.yml  # Provision Oracle instance
│       └── inventory/
│
├── docs/
│   ├── superpowers/
│   │   └── specs/                 # Design documents (this file lives here)
│   ├── api/                       # OpenAPI specs (auto-generated from NestJS)
│   └── architecture/              # Diagrams, ADRs
│
├── scripts/
│   ├── dev.sh                     # Start local dev environment
│   ├── seed.sh                    # Seed database with test data
│   ├── edge-deploy.sh             # Deploy to a Hetzner edge node
│   └── generate.sh                # Generate types, client code
│
├── go.work                        # Go workspace (edge-proxy, cli, go-sdk)
├── turbo.json                     # Turborepo task graph
├── pnpm-workspace.yaml            # pnpm workspace config
├── package.json                   # Root package.json
└── .github/
    └── workflows/
        ├── ci.yml                 # PR: lint, test, type-check
        ├── build.yml              # Push to main: build + push Docker images
        └── deploy-staging.yml     # Auto-deploy to staging
```

### Key Conventions

**Every NestJS service follows the same structure:**

```
apps/<service-name>/src/
  <domain>/
    <domain>.controller.ts    # HTTP layer, no business logic
    <domain>.service.ts       # Business logic
    <domain>.repository.ts    # Database queries (using Prisma)
    <domain>.module.ts        # NestJS module wiring
    dto/                      # Request/Response DTOs (class-validator)
    entities/                 # TypeScript interfaces (from shared-types)
  app.module.ts
  main.ts
```

**Every NestJS service exposes:**

- `GET /health` — liveness check
- `GET /health/ready` — readiness check (DB connected, etc.)
- `GET /metrics` — Prometheus metrics (via prom-client)

---

## 7. Common Architecture Mistakes

This section documents mistakes that are frequently made when building CDN, storage, and distributed systems. Study these before writing the first line of code.

---

### 7.1 CDN Architecture Mistakes

**Mistake 1: Cache stampede (Thundering Herd)**
When a popular cached object expires, hundreds of requests hit the origin simultaneously before any response is cached. This can take down origins.
*Prevention:* Implement probabilistic early expiration (PER) or mutex-based single-flight: only one request fetches from origin; all others wait on the in-flight response.

**Mistake 2: Inconsistent cache keys**
Serving `https://example.com/image.png` and `https://example.com/image.png?v=1` as different cache entries when they are the same object. Query parameter normalization is critical.
*Prevention:* Explicit cache key rules per zone: whitelist which query params are included in the cache key. Default: strip all query params for static assets.

**Mistake 3: Caching errors**
Caching a 500 or 404 response with a long TTL. Now all users see the error until TTL expires.
*Prevention:* Never cache 5xx responses. Cache 404s with a short TTL only (30 seconds). Always allow stale content to be served on origin error (stale-if-error).

**Mistake 4: Not implementing Range request support**
Large files (video, large downloads) use HTTP Range requests. An edge that does not handle Range requests correctly will either not serve partial content or will fetch the entire file for a partial request.
*Prevention:* Handle `Range` header in the edge proxy. For cached objects, serve the range from the cached full object. For uncached objects, forward the Range to origin.

**Mistake 5: Ignoring `Vary` header**
The `Vary: Accept-Encoding` header means the same URL has different cache entries for gzip and brotli responses. Ignoring this serves gzip content to clients that requested brotli and vice versa.
*Prevention:* Include Vary header values in the cache key.

**Mistake 6: Synchronous cache invalidation**
Building invalidation as a synchronous REST call that waits for all edge nodes to confirm. This adds latency to the API response and fails if any edge node is unavailable.
*Prevention:* Invalidation is always asynchronous. API acknowledges immediately; NATS event propagates to edges in the background. Track invalidation status separately.

---

### 7.2 Distributed Systems Mistakes

**Mistake 1: Synchronous communication everywhere**
Making every inter-service call a synchronous HTTP request. If Service B is slow, Service A is slow. If Service B is down, Service A fails.
*Prevention:* Distinguish between synchronous (user is waiting) and asynchronous (fire and forget) operations. Cache invalidation, analytics event emission, email sending — all async via NATS.

**Mistake 2: No idempotency on writes**
A client retries a `POST /buckets` request due to a timeout. The request was already processed, so now two buckets are created.
*Prevention:* Every write operation must be idempotent. Accept an `Idempotency-Key` header. Store processed keys in Redis with TTL. On duplicate: return the original response.

**Mistake 3: Shared database between services**
Two services query the same PostgreSQL tables. Now you cannot deploy one service independently because the other depends on its schema.
*Prevention:* Each service owns its data. Identity Service owns `users` and `organizations`. CDN Service owns `pull_zones` and `cache_rules`. Services access each other's data via API calls, never direct database queries.

**Mistake 4: Not versioning APIs from day one**
Shipping `/api/cdn` instead of `/api/v1/cdn`. When breaking changes are needed, you cannot version without a painful migration.
*Prevention:* Every API is versioned from day one: `/api/v1/...`. The version lives in the URL, not a header.

**Mistake 5: Missing circuit breakers**
Edge proxy calls origin. Origin is slow. Edge proxy has 1,000 concurrent requests waiting on origin. Edge proxy runs out of goroutines/memory and crashes.
*Prevention:* Implement circuit breakers on all external calls. Go: use `github.com/sony/gobreaker`. If origin fails 50% of requests in 10s, open the circuit and serve stale content.

**Mistake 6: No distributed tracing**
A request is slow. It passes through Traefik → Identity Service → CDN Service → Edge Proxy. Without tracing, you cannot tell which service added latency.
*Prevention:* Propagate `traceparent` (W3C Trace Context) headers through every service from day one. Use OpenTelemetry. Instrument before you need it — retrofitting tracing is painful.

---

### 7.3 Cache Design Mistakes

**Mistake 1: Using cache as the primary data store**
Storing objects only in Redis. Redis data is lost on restart. Redis is a cache, not a database.
*Prevention:* Cache is always a copy of data that exists durably elsewhere. Redis cache entry loss is acceptable. PostgreSQL data loss is not.

**Mistake 2: No stale-while-revalidate**
Cache expires; user waits for origin response before getting content. This creates a visible latency spike for cache misses.
*Prevention:* Implement stale-while-revalidate: serve stale content immediately while fetching a fresh copy in the background. Common for content where slight staleness is acceptable (images, JS bundles).

**Mistake 3: Too-large cache TTLs on mutable content**
Caching user-specific API responses for 1 hour. User updates their profile; CDN serves stale profile data for 1 hour.
*Prevention:* Define content categories with appropriate TTLs: static immutable assets (1 year), media (7 days), API responses (0 unless explicitly cacheable), HTML (5 minutes or stale-while-revalidate).

**Mistake 4: Not purging on write**
User updates their avatar. The Storage Service stores the new avatar. The CDN still serves the old one because nobody invalidated the cache.
*Prevention:* Storage Service publishes `object.updated` event. CDN Service subscribes and invalidates corresponding CDN URLs. This is an event-driven cache invalidation pattern.

---

### 7.4 Storage Mistakes

**Mistake 1: Storing files in PostgreSQL BLOBs**
Small files (< 1MB) might seem fine in `bytea` columns. This destroys database performance, prevents streaming, and eliminates all storage-specific features.
*Prevention:* All binary objects go to MinIO. PostgreSQL stores only metadata (path, size, hash, content-type).

**Mistake 2: No multipart upload from day one**
A user tries to upload a 5GB video file via a single HTTP request. Connection drops at 4.9GB. They have to start over.
*Prevention:* Design the upload flow as multipart from the beginning. The Storage Service creates a presigned MinIO multipart upload URL. The client uploads in parts. Server assembles. This also enables resumable uploads.

**Mistake 3: Not planning for content-addressable storage**
The same 1GB image is uploaded by 1,000 users. Each one is stored separately. You pay 1,000x the storage cost.
*Prevention:* Store objects by their SHA-256 hash (content-addressable). Reference counting tracks how many objects point to each hash. Identical content is stored once. Implement this in Phase 2 after the basic storage is proven.

**Mistake 4: Sync uploads blocking the API thread**
The Storage Service streams the upload to MinIO synchronously. Large uploads block the NestJS event loop thread.
*Prevention:* Never stream large files through the NestJS API. Generate presigned upload URLs — clients upload directly to MinIO. The API thread is never in the upload data path.

---

### 7.5 Deployment Mistakes

**Mistake 1: No graceful shutdown**
A container is stopped (SIGTERM). It immediately exits. In-flight requests fail.
*Prevention:* All services handle SIGTERM. Go: use `http.Server.Shutdown(ctx)`. NestJS: use `app.enableShutdownHooks()`. Drain in-flight requests before exiting. Kubernetes `terminationGracePeriodSeconds: 30`.

**Mistake 2: No health checks**
Kubernetes marks a pod ready before the database connection is established. Requests hit the pod and fail.
*Prevention:* Every service implements `/health` (liveness: process is running) and `/health/ready` (readiness: DB connected, Redis connected, dependencies available). Configure both in Kubernetes.

**Mistake 3: Secrets in environment variables baked into images**
Docker build args or `.env` files committed to git. Secret is now in git history forever.
*Prevention:* Secrets are never in container images or git. In development: `.env` files in `.gitignore`. In production: Kubernetes Secrets or a secrets manager (Vault, AWS Secrets Manager).

**Mistake 4: No rollback strategy**
A bad deployment goes out. There is no way to quickly revert.
*Prevention:* Blue/Green deployment from Stage 3 onwards. Two identical deployments; Traefik routes traffic. Rollback = flip the routing rule. Automated rollback triggered by error rate SLO breach.

---

### 7.6 Scaling Mistakes

**Mistake 1: Stateful services that can't scale horizontally**
Storing session data in memory in the NestJS process. Adding a second instance breaks sessions.
*Prevention:* All session state lives in Redis. All NestJS services are stateless. Horizontal scaling is a `kubectl scale deployment` command.

**Mistake 2: No connection pooling**
10 NestJS pod replicas each holding 10 PostgreSQL connections = 100 connections. PostgreSQL struggles above ~200 connections.
*Prevention:* Deploy PgBouncer as a connection pool in front of PostgreSQL. Each service connects to PgBouncer (transaction pooling mode). PostgreSQL sees a manageable number of connections regardless of pod count.

**Mistake 3: Using the database as a message queue**
`SELECT ... WHERE status='pending' FOR UPDATE SKIP LOCKED` to implement a job queue. Works until you have 10,000 pending jobs and it becomes a table scan.
*Prevention:* Use NATS JetStream for async jobs. It's designed for this. PostgreSQL is not.

**Mistake 4: Premature optimization**
Implementing ClickHouse, Kafka, and a distributed cache before you have a single real user. You're solving problems you don't have yet.
*Prevention:* Follow the scaling stages defined in Section 4. Add complexity only when a specific, measured bottleneck forces it. "It might be slow" is not a bottleneck. A measured P95 latency breach is.

---

*End of Master Architecture Document*
*Companion document: 2026-06-29-Rivocloud-phase1-cdn-edd.md*