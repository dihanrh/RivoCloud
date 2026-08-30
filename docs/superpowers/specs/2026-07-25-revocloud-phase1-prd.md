# RivoCloud — Phase 1 Product Requirements Document (PRD)

**Status:** Draft — Stages 1-6 (Infrastructure Foundation, Identity Service, Go Edge Proxy, CDN Service, Storage Service, Dashboard MVP: auth/zone/storage UI) complete, Stages 7–16 not started.
**Owner:** RivoCloud engineering.
**Companion documents:**
- [`2026-06-29-revocloud-master-architecture.md`](2026-06-29-revocloud-master-architecture.md) — product vision, long-term strategy, technology decisions (the "why" behind the whole product).
- [`2026-06-29-revocloud-phase1-cdn-edd.md`](2026-06-29-revocloud-phase1-cdn-edd.md) — the engineering design: microservices, database schema, REST API, security architecture (the "how" it's built).
- [`../../phase1-explained-for-beginners.md`](../../phase1-explained-for-beginners.md) — plain-language glossary and walkthroughs of every concept in this PRD.
- [`../../phase1-development-flow.md`](../../phase1-development-flow.md) — the roadmap in Section 7 below, as a dependency diagram.
- `../../concepts/` — one beginner-friendly concept doc per roadmap step (see Section 7).

This document is the **product-facing counterpart** to the EDD: it states *what* RivoCloud Phase 1 must do and *why*, and *in what order*, without repeating the EDD's schema/API/infrastructure detail. Read the EDD alongside this when a requirement needs its technical implementation.

---

## 1. Overview & Problem Statement

A typical startup shipping a web product ends up stitching together a CDN (e.g. CloudFront), object storage (e.g. S3), and a separate dashboard/billing setup for each — multiple vendors, multiple bills, multiple SDKs, and none of them share an identity or permissions model. Existing CDNs either expose 200+ confusing configuration options (CloudFront) or are simple but not programmable (Bunny.net).

**RivoCloud Phase 1** solves this by building a single, unified platform — CDN, object storage, cache management, analytics, and billing — behind one dashboard, one API, and one auth model, deployable first on a single machine and scaling out to a real multi-location CDN. Phase 1 is the foundation the rest of the RivoCloud vision (media processing, edge functions, AI-native caching — see the master architecture's Future Roadmap) is built on top of.

**Definition of done for Phase 1:** RivoCloud can onboard a paying customer who creates a CDN zone, points traffic at it, uploads files to storage, sees real analytics, manages their team with roles, and pays via Stripe — running on real, geographically distributed edge infrastructure.

---

## 2. Goals & Success Metrics

| Goal | Success Metric |
|---|---|
| Prove the core CDN loop works | A request to an uncached path is a cache miss; the same request seconds later is a cache hit (L1, <1ms) |
| Make onboarding effortless | A new user can register, create an org, and serve their first cached asset through the dashboard in under 5 minutes |
| Reach production-safe multi-tenancy | Every resource (zone, bucket, API key) is scoped to an organization; RBAC blocks out-of-role actions in 100% of enforced endpoints |
| Make the CDN real, not a single reverse proxy | At least one additional physical edge location (Hetzner, Month 8) actively serves traffic alongside the control-plane region |
| Reach monetization | Stripe billing live, plan limits enforced, first paying customer possible by Month 7 |
| Launch publicly | Public beta live by Month 10 with docs, SDK, CLI, and an onboarding flow, per the Month 10 roadmap milestone |

---

## 3. Target Users / Personas

Reused from the master architecture's customer segmentation (Section "Who Are the Customers?"):

- **Solo developers / indie hackers** — want simple pricing and a single dashboard instead of juggling AWS consoles.
- **Startups (seed–Series A)** — need CDN + storage together, at lower cost and complexity than CloudFront + S3.
- **SMBs with media-heavy products** — e-commerce/video sites that need CDN and storage tightly integrated.
- **DevOps-forward engineering teams** — want a programmable API/CLI/SDK, not a black-box CDN console.

(AI application builders are a target segment for the *product* long-term, but their specific needs — semantic caching, Edge Functions — are explicitly out of scope for Phase 1; see Section 4.)

---

## 4. Scope & Non-Goals

### In scope for Phase 1

Everything in the EDD's Feature Checklist (Section 1): origin-pull and origin-push CDN, Redis-backed edge caching, custom domains with automatic TLS, organizations/RBAC/API keys, S3-compatible object storage, cache rules and invalidation, signed URLs, cache and request analytics, Stripe billing, a full dashboard, a JavaScript SDK, a CLI, and one additional real edge location (Hetzner PoP).

### Explicitly out of scope for Phase 1

Carried over verbatim from the EDD (Section 1), since these are hard architectural dependencies on Phase 1 being complete first:

- Image optimization / video transcoding (Phase 2)
- Edge Functions / WASM runtime (Phase 3)
- AI Cache / semantic caching (Phase 4)
- API Gateway (Phase 3)
- Multi-region PostgreSQL and BGP Anycast (Phase 3+)
- Customer webhook delivery infrastructure (Phase 2)
- Object versioning UI and lifecycle policy execution (Phase 2 — database columns exist, but no UI/automation yet)

**Geographic scope:** one control-plane region (Oracle Cloud) plus up to 3 Hetzner edge PoPs. This is not multi-region infrastructure — see the master architecture's Scaling Strategy Stage 5+ for when that happens.

---

## 5. Functional Requirements

Grouped by product area. Priority (P0/P1/P2) and target month match the EDD's Feature Checklist.

### 5.1 Identity & Organizations (P0, Month 1)
- Users can register, log in, log out, and refresh their session (JWT-based).
- Every resource belongs to an organization; organizations have multiple members with roles (Owner/Admin/Developer/Viewer).
- Users can create, view, and revoke scoped API keys for programmatic access.

### 5.2 CDN / Zones (P0, Month 2)
- A user can create a "zone" pointing at their origin server; the CDN proxies and caches requests to it (origin pull).
- Responses are served from a 3-layer cache (in-process LRU → Redis → origin) with correct `Cache-Control`/ETag/conditional-request handling.
- Zone configuration changes propagate to the edge proxy without a restart.

### 5.3 Custom Domains + TLS (P0, Month 3)
- A user can attach their own domain to a zone.
- TLS certificates are issued and renewed automatically (Let's Encrypt via Traefik) — no manual certificate handling.
- Domain status (pending/verifying/active) is visible in the dashboard.

### 5.4 Object Storage (P0, Month 3)
- A user can create buckets and upload/download objects via presigned URLs (file bytes never pass through RivoCloud's own API servers).
- Objects uploaded to storage can be served directly through a CDN zone (origin push).

### 5.5 Cache Management (P1, Month 4)
- Per-zone cache rules: match a URL path pattern, set a TTL or bypass caching entirely.
- On-demand cache invalidation (purge) by path pattern or tag, reflected across every edge proxy within seconds via NATS.

### 5.6 Signed URLs (P1, Month 6)
- A user can generate a time-limited, cryptographically signed URL for a private object; the edge proxy rejects expired or tampered signatures.

### 5.7 Analytics (P1, Month 5)
- Cache hit/miss ratio, bandwidth, request counts, geography, and latency are visible per zone in the dashboard, updated close to real time.

### 5.8 Security, RBAC & Audit (P0/P1, Months 1 & 6)
- Every mutating action is checked against the caller's role before executing.
- Every mutation is recorded in an audit log, visible to Owners/Admins.
- Auth and other sensitive endpoints are rate-limited.

### 5.9 Billing (P2, Month 7)
- Organizations can subscribe to a paid plan via Stripe Checkout and manage billing via the Stripe Customer Portal.
- Usage (bandwidth, requests) is metered from analytics data; plan limits are enforced (e.g. zones disabled if a free-tier org exceeds its bandwidth cap).

### 5.10 Dashboard (P1, ongoing)
- A web UI (Next.js) covering every feature above: auth, zone/domain management, storage browser, cache rules, analytics charts, team/API-key settings, billing.

### 5.11 SDK & CLI (P2, Month 9–10)
- A JavaScript/TypeScript SDK and a Go CLI wrap the REST API for zone management, storage upload, and cache invalidation.

### 5.12 Distributed Edge (P1, Month 8)
- At least one additional physical edge location (Hetzner, Nuremberg) serves real traffic, with GeoDNS routing EU visitors there and cache-invalidation events reaching it via a NATS cluster.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | L1 (in-process) cache hits served in <1ms; L2 (Redis) cache hits in <1ms typical; origin/miss path latency dominated by the customer's own origin server, not RivoCloud overhead. |
| **Availability** | Single-machine (Docker Compose) is an accepted tradeoff through Month 8; Kubernetes migration (Month 9) removes single-point-of-failure risk for the control plane before public beta. |
| **Security** | Secrets never committed to git; passwords/API keys hashed at rest; TLS enforced on all customer-facing domains; RBAC enforced on every mutating endpoint; audit log covers every mutation. |
| **Scalability path** | Must not architecturally block the master architecture's later stages (multi-region control plane, BGP Anycast, K8s multi-edge) — e.g. every API is versioned (`/api/v1/...`) from day one. |
| **Observability** | Every service instrumented with OpenTelemetry traces/metrics from Month 1; Prometheus + Grafana + Loki available for metrics, dashboards, and logs from Stage 1 onward. |
| **Portability** | Object storage uses the S3-compatible API (MinIO) so workloads aren't locked to a proprietary storage format. |

---

## 7. Implementation Roadmap

The 16-stage build order from the EDD (Section 11, Development Order), unchanged — this PRD adds product-facing status tracking and links each stage to its beginner concept doc. Dependencies are "must be built before," not runtime call direction (see [`phase1-development-flow.md`](../../phase1-development-flow.md) for the full dependency diagram).

| # | Stage | Target Month | Status | Depends On | Concept Doc |
|---|---|---|---|---|---|
| 1 | Infrastructure Foundation — monorepo, Docker Compose, Prisma schema, CI | 1 | ✅ Done | — | [`docker-compose-and-infrastructure.md`](../../concepts/docker-compose-and-infrastructure.md) |
| 2 | Identity Service — auth, orgs, API keys, auth guard | 1 | ✅ Done | 1 | [`identity-service-and-auth.md`](../../concepts/identity-service-and-auth.md) |
| 3 | Go Edge Proxy (Basic) — HTTP server, Redis (L2), in-process LRU (L1) | 2 | ✅ Done | 1 | [`edge-proxy-and-caching.md`](../../concepts/edge-proxy-and-caching.md) |
| 4 | CDN Service — zone CRUD, config publish to Redis | 2 | ✅ Done | 2, 3 | [`cdn-zones-and-configuration.md`](../../concepts/cdn-zones-and-configuration.md) |
| 5 | Storage Service — bucket CRUD, presigned upload, MinIO webhook | 3 | ✅ Done | 2 | [`object-storage-and-uploads.md`](../../concepts/object-storage-and-uploads.md) |
| 6 | Dashboard MVP — auth pages, zone UI, storage UI | 1–3 | ✅ Done (6.1–6.3: auth, zone UI, storage UI) | 2, 4, 5 | [`dashboard-and-frontend.md`](../../concepts/dashboard-and-frontend.md) |
| 7 | NATS Invalidation — cache invalidation + cache rules engine | 4 | ✅ Done (7.1–7.2: invalidation, cache rules) | 4 | [`cache-invalidation-and-messaging.md`](../../concepts/cache-invalidation-and-messaging.md) |
| 8 | Custom Domains + TLS — Traefik Redis provider, DNS verification | 3 | Not started | 4 | [`custom-domains-and-tls.md`](../../concepts/custom-domains-and-tls.md) |
| 9 | Analytics — edge events to NATS, ClickHouse ingestion, charts | 5 | Not started | 3, 6 | [`analytics-and-clickhouse.md`](../../concepts/analytics-and-clickhouse.md) |
| 10 | Signed URLs — HMAC generation + edge verification | 4 | Not started | 5 | [`signed-urls-and-hmac.md`](../../concepts/signed-urls-and-hmac.md) |
| 11 | Security + RBAC — roles, audit logging, rate limiting | 6 | Not started | 2 | [`security-rbac-and-audit-logging.md`](../../concepts/security-rbac-and-audit-logging.md) |
| 12 | Billing — Stripe Checkout, webhooks, plan limits | 7 | Not started | 2, 9 | [`billing-and-stripe.md`](../../concepts/billing-and-stripe.md) |
| 13 | Kubernetes Migration — k3s on Oracle, ArgoCD GitOps | 9 | Not started | 4, 5, 6, 7, 8, 9, 10, 11, 12 | [`kubernetes-and-gitops.md`](../../concepts/kubernetes-and-gitops.md) |
| 14 | First Hetzner Edge Node — Ansible, edge-proxy + Redis, NATS cluster, GeoDNS | 8 | Not started | 13 | [`edge-nodes-and-geodns.md`](../../concepts/edge-nodes-and-geodns.md) |
| 15 | SDK + CLI — JS/TS SDK, Go CLI | 10 | Not started | 4, 5, 7 | [`sdk-and-cli.md`](../../concepts/sdk-and-cli.md) |
| 16 | Public Beta — docs site, landing page, onboarding, launch | 10 | Not started | 14, 15 | [`public-beta-and-launch.md`](../../concepts/public-beta-and-launch.md) |

**Sequencing principle** (from the EDD): foundation → core mechanism → management layer → polish layer, repeated per area, always ordered so an earlier stage supplies something a later one needs — e.g. cache invalidation (7) cannot be built before there's an Edge Proxy that caches (3) and a CDN Service that manages zones (4).

Each stage, when it begins implementation, gets its own detailed engineering plan under `docs/superpowers/plans/`, following the same pattern as [`2026-07-18-phase1-stage1-infrastructure-foundation.md`](../plans/2026-07-18-phase1-stage1-infrastructure-foundation.md).

---

## 8. Risks & Assumptions

| Risk / Assumption | Mitigation |
|---|---|
| Running everything on Docker Compose through Month 8 is a single point of failure. | Accepted tradeoff to move fast pre-revenue; Kubernetes migration (Stage 13) is scheduled before public beta, not after. |
| Building RBAC/audit/rate-limiting last (Stage 11) means early stages temporarily lack full enforcement. | Acceptable during internal development with no real customer data; Stage 11 must land before Stage 16 (Public Beta). |
| Two roadmap orderings exist (Section 10 "Development Roadmap" by month vs. Section 11 "Development Order" by dependency) and don't perfectly align chronologically. | This PRD and `phase1-development-flow.md` follow the dependency order (Section 11) as authoritative when the two disagree — noted explicitly in that document. |
| Stripe billing (Stage 12) depends on usage data from Analytics (Stage 9). | Sequencing already reflects this dependency in the roadmap table above. |

---

## 9. References

- [`2026-06-29-revocloud-master-architecture.md`](2026-06-29-revocloud-master-architecture.md) — Sections 1–2 (Product Vision, Product Strategy)
- [`2026-06-29-revocloud-phase1-cdn-edd.md`](2026-06-29-revocloud-phase1-cdn-edd.md) — Sections 1, 10, 11 (Scope, Roadmap, Development Order)
- [`../../phase1-explained-for-beginners.md`](../../phase1-explained-for-beginners.md)
- [`../../phase1-development-flow.md`](../../phase1-development-flow.md)
