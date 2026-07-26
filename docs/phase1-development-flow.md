# Phase 1 — Development Flow

Source: [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 10 (Development Roadmap) and Section 11 (Development Order).

Build sequence and dependencies for RivoCloud Phase 1 (CDN), grouped by the 16 build stages from the Development Order, annotated with their target roadmap month.

```mermaid
graph TD
    A["1. Infrastructure Foundation<br/>Monorepo, Docker Compose, Prisma schema, CI<br/>(Month 1)"]
    B["2. Identity Service<br/>Auth, Orgs, API Keys, Auth Guard<br/>(Month 1)"]
    C["3. Go Edge Proxy — Basic<br/>HTTP server, Redis (L2), In-process LRU (L1)<br/>(Month 2)"]
    D["4. CDN Service<br/>Zone CRUD, config publish to Redis<br/>(Month 2)"]
    E["5. Storage Service<br/>Bucket CRUD, presigned upload, MinIO webhook<br/>(Month 3)"]
    F["6. Dashboard MVP<br/>Auth pages, zone UI, storage UI<br/>(Month 1-3)"]
    G["7. NATS Invalidation<br/>Cache invalidation + cache rules engine<br/>(Month 4)"]
    H["8. Custom Domains + TLS<br/>Traefik Redis provider, DNS verification<br/>(Month 3)"]
    I["9. Analytics<br/>Edge events to NATS, ClickHouse ingestion, charts<br/>(Month 5)"]
    J["10. Signed URLs<br/>HMAC generation + edge verification<br/>(Month 4)"]
    K["11. Security + RBAC<br/>Roles, audit logging, rate limiting<br/>(Month 6)"]
    L["12. Billing<br/>Stripe Checkout, webhooks, plan limits<br/>(Month 7)"]
    M["13. Kubernetes Migration<br/>k3s on Oracle, ArgoCD GitOps<br/>(Month 9)"]
    N["14. First Hetzner Edge Node<br/>Ansible, edge-proxy + Redis, NATS cluster, GeoDNS<br/>(Month 8)"]
    O["15. SDK + CLI<br/>JS/TS SDK, Go CLI<br/>(Month 10)"]
    P["16. Public Beta<br/>Docs site, landing page, onboarding, launch<br/>(Month 10)"]

    A --> B
    A --> C
    B --> D
    C --> D
    B --> E
    B --> F
    D --> F
    E --> F
    D --> G
    D --> H
    C --> I
    E --> J
    B --> K
    B --> L
    I --> L
    D --> M
    E --> M
    F --> M
    G --> M
    H --> M
    I --> M
    J --> M
    K --> M
    L --> M
    M --> N
    D --> O
    E --> O
    G --> O
    N --> P
    O --> P
```

## Notes

- Arrows represent build dependencies ("depends on"), not runtime call direction.
- Stage numbers and month labels match Section 11 (Development Order) and Section 10 (Development Roadmap) of the Phase 1 EDD respectively — the two sections don't perfectly align chronologically (e.g. Kubernetes is ordered before the first edge node in Section 11, but scheduled a month after it in Section 10); this diagram follows the dependency order in Section 11.
- Excluded from Phase 1 (see Section 1 of the EDD): image/video processing, Edge Functions, AI/semantic caching, API Gateway, multi-region Postgres, BGP Anycast, customer webhooks, object versioning UI, lifecycle policy execution.
