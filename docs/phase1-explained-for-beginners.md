# Phase 1 — Explained for Beginners

This document explains **RivoCloud's Phase 1** in plain language: what it is, what every technical term means, and how all the pieces connect to each other. It's a companion to the detailed specs:

- [`superpowers/specs/2026-06-29-revocloud-master-architecture.md`](superpowers/specs/2026-06-29-revocloud-master-architecture.md) — the overall vision
- [`superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) — the detailed Phase 1 design
- [`phase1-development-flow.md`](phase1-development-flow.md) — the build-order diagram

Read this first if the specs feel overwhelming. Once the terms click, the specs will make much more sense.

---

## 1. What is RivoCloud, in one paragraph?

Imagine you built a website. Your website's files (images, videos, HTML, API responses) live on one server. If someone in Japan visits your site, but your server is in Germany, the data has to travel halfway around the world — slow. A **CDN (Content Delivery Network)** solves this by making copies of your content and storing them on servers scattered around the world, close to your visitors. RivoCloud is a company/product that **builds a CDN, plus file storage, plus a dashboard to manage it all** — similar to services like Cloudflare or Bunny.net, but built from scratch.

**Phase 1** is the first big chunk of work: build a working CDN + storage platform that real, paying customers could use. Everything after Phase 1 (AI features, video processing, etc.) is future work and explicitly *not* part of this phase.

---

## 2. The Big Picture: Two "Worlds"

Every term in this project belongs to one of two worlds. Understanding this split is the single most important concept.

### The Control Plane ("the office")
This is where **configuration and management** happens: creating accounts, setting up a CDN zone, viewing analytics, paying the bill. It's not touched by every single visitor to a customer's website — only by the RivoCloud *customer* (the person managing their account) or automated internal processes.

Think of it like a restaurant's back office: taking reservations, managing the menu, doing payroll. Customers eating at the tables don't interact with the back office directly.

### The Data Plane ("the front counter")
This is the part that touches **every single request** from **every website visitor**, all day, every day. It needs to be extremely fast because it's in the direct path of real traffic. In RivoCloud, this is the **Edge Proxy** — explained below.

Think of it like the restaurant's serving staff: every customer interacts with them directly, so they need to be fast and efficient.

**Why the split matters:** the office (control plane) can be a little slow without anyone noticing — nobody cares if "create a new CDN zone" takes 200ms. But the front counter (data plane) must be near-instant, because it's serving real website visitors thousands of times a second. So RivoCloud builds these two worlds with different tools:

| | Control Plane | Data Plane |
|---|---|---|
| Cares most about | Being correct, easy to build, secure | Being blazing fast |
| Built with | TypeScript / NestJS (a web framework) | Go (a fast, compiled programming language) |
| Talks to customers directly? | Yes (via dashboard/API) | No — talks to website *visitors* |
| Example action | "Create a new CDN zone" | "Serve this cached image in 2 milliseconds" |

---

## 3. Glossary — every term, explained simply

Terms are grouped by theme. Each entry says **what it is**, **why it exists**, and **what it connects to**.

### 3.1 CDN Concepts

**CDN (Content Delivery Network)**
A network of servers spread across different physical locations that store copies of website content close to visitors, so pages load faster. This is the core product RivoCloud is building in Phase 1.

**Origin**
The customer's *original* server — the "source of truth" for their content. E.g., if a customer runs their API at `api.customer-backend.com`, that's the origin. The CDN's job is to avoid hitting the origin repeatedly by serving cached copies instead.

**Zone (Pull Zone)**
A configuration record representing "one website/API that RivoCloud is caching for a customer." A zone says things like: "cache content from `origin_url`, with a default cache time (TTL) of 1 hour." Every CDN feature (custom domains, cache rules, analytics) is attached to a zone. **Connects to:** the `pull_zones` database table, the CDN Service, and the Edge Proxy (which reads zone configs to know how to behave).

**Origin Pull vs Origin Push** — two ways content gets into the CDN:
- **Origin Pull:** the CDN fetches content from the customer's existing server *on demand*, the first time it's requested, then caches it. This is the "classic" CDN mode.
- **Origin Push:** the customer *uploads* files directly into RivoCloud's own storage ahead of time (see Object Storage below), and the CDN serves those files without ever contacting an external origin.

**Cache** (verb & noun)
A cache is a temporary copy of data stored somewhere fast, so you don't have to re-fetch or re-compute it. "To cache" a response means saving a copy of it. The entire point of a CDN is caching.

**Cache Hit / Cache Miss**
- **Hit:** the requested content was already in the cache — served instantly, no need to contact the origin.
- **Miss:** the content wasn't cached yet (or expired) — the system has to fetch it from origin/storage, which is slower, and *then* cache it for next time.

**TTL (Time To Live)**
How long a cached item is considered "fresh" before it must be re-checked or re-fetched. E.g., "cache this image for 7 days (TTL = 7 days)." After the TTL expires, the cache is stale.

**Edge TTL vs Browser TTL**
- **Edge TTL:** how long *RivoCloud's* servers keep something cached.
- **Browser TTL:** the `Cache-Control` value RivoCloud tells the *visitor's own browser* to use. These are independent — RivoCloud might cache something on its edge servers for 7 days but tell browsers to only cache it for 1 hour.

**Cache Key**
The unique "label" used to look up a cached item — usually built from the zone, the URL path, and sometimes query parameters or headers. If two different requests produce the same cache key, they get the same cached response. Getting this wrong is a classic CDN bug (e.g., accidentally treating `/image.png` and `/image.png?v=1` as different cached items when they're really the same file).

**Cache Invalidation (Purge)**
Manually telling the CDN "forget your cached copy of X, it's out of date now" — used when a customer updates their content and doesn't want to wait for the TTL to expire naturally.

**Cache Rules**
Per-zone configuration that says: "for URLs matching this pattern, use this TTL / bypass the cache entirely." E.g., `/api/*` → never cache (TTL 0), `/assets/*.js` → cache for a year. **Connects to:** the Edge Proxy (which evaluates the rules for every request) and the CDN Service (which lets customers create/edit rules).

**Signed URL**
A special URL with a built-in expiration time and a cryptographic signature, used to give temporary, controlled access to private files (e.g., "this download link only works for the next 15 minutes"). **Connects to:** the Storage Service (which creates signed URLs) and the Edge Proxy (which checks the signature is valid before serving the file).

**ETag**
A short "fingerprint" (like a hash) of a piece of content, sent in HTTP responses. Browsers/CDNs use it to ask "has this content changed since I last saw ETag X?" without re-downloading the whole thing — saves bandwidth.

**Range Request**
An HTTP feature that lets a client ask for only *part* of a file (e.g., bytes 1,000–2,000 of a video), used for video seeking and resumable downloads.

**Custom Domain**
Letting a customer use their own domain name (e.g., `cdn.their-company.com`) to access RivoCloud's CDN, instead of a RivoCloud-provided subdomain. Requires DNS setup and an SSL certificate.

**TLS / SSL / HTTPS**
The encryption layer that makes web traffic secure (the padlock icon in browsers). "SSL" is the old name, "TLS" is the modern/correct name, but people use them interchangeably. RivoCloud automatically issues free TLS certificates for custom domains using **Let's Encrypt**, a free certificate authority.

### 3.2 Storage Concepts

**Object Storage**
A simple way to store files ("objects") identified by a key (like a filename/path), accessed over an API — similar to Amazon S3 (hence "S3-compatible"). RivoCloud uses **MinIO** (see below) to implement this. **Connects to:** the Storage Service (manages metadata) and buckets/objects (see below).

**Bucket**
A named container for objects, similar to a folder or a top-level directory, but for object storage. Each customer creates buckets to organize their files.

**Presigned URL**
A temporary, secure URL that lets a client (like a browser) upload or download a file *directly* to/from storage, without routing the actual file bytes through RivoCloud's own API servers. This makes uploads much more scalable — the API server just hands out a URL, and the heavy lifting (transferring gigabytes of data) happens directly between the client and storage.

**Multipart Upload**
A way to upload a large file in smaller chunks ("parts") instead of one giant request — so if the connection drops at 90%, you only need to retry the last chunk, not start over.

**Object Versioning**
Keeping old copies of a file when it's overwritten, so you can restore a previous version later. (Phase 1 builds the database columns for this, but the actual feature — restoring old versions — is deferred to Phase 2.)

**Lifecycle Policy**
A rule like "automatically delete files in this folder after 30 days" — automated cleanup. (Same as versioning: the database is ready in Phase 1, but the automation that *executes* these rules is Phase 2.)

### 3.3 Core Infrastructure Pieces (the "ingredients")

**Edge Proxy**
The single most important piece of software in the whole system — the actual program that receives every visitor's HTTP request, checks the cache, and either returns a cached response or fetches a fresh one. Written in **Go** for speed. This is the entire "Data Plane" described in Section 2. **Connects to:** Redis (its cache), NATS (to hear about cache invalidations), MinIO (to fetch stored files), and the CDN Service (to get its configuration).

**PoP (Point of Presence)**
A physical server location running an Edge Proxy, placed close to real users (e.g., "our PoP in Nuremberg, Germany" or "our PoP in Singapore"). More PoPs = faster CDN for more parts of the world. Phase 1 starts with everything running in one place and adds a second physical PoP later (Month 8).

**Redis**
An extremely fast in-memory database, mainly used here as: (1) the CDN's cache storage (Layer 2, see "3-layer cache" below), and (2) temporary storage for things like login sessions and rate-limit counters. "In-memory" means data lives in RAM, not on disk — that's what makes it so fast, but data can be lost if Redis restarts (which is fine, since it's just a cache, not the permanent source of truth).

**3-Layer Cache (L1 / L2 / L3)**
The Edge Proxy doesn't check just one cache — it checks three, from fastest-but-smallest to slowest-but-bigger:
1. **L1 — In-process LRU:** a cache held directly in the Edge Proxy's own memory. Fastest (~0.1ms) but small and not shared between multiple copies of the proxy.
2. **L2 — Local Redis:** a shared Redis cache used by all Edge Proxy processes in the same physical location. Slightly slower (~0.5ms) but bigger and shared.
3. **L3 — MinIO:** the actual object storage. Used when nothing is cached and the content lives in RivoCloud's own storage (i.e., "push zones"). Slower (~20-50ms) but has effectively unlimited capacity.
If all three miss, the proxy finally goes to the customer's **origin** server (see above) — the slowest option, since it might be anywhere on the internet.

**LRU (Least Recently Used)**
A common cache eviction strategy: when the cache is full and something new needs to be stored, throw away whichever item hasn't been used in the longest time. This is how the in-process L1 cache decides what to keep.

**MinIO**
A software package that implements object storage (see above) in a way that's compatible with Amazon S3's API. RivoCloud runs its own MinIO servers instead of paying Amazon, but any tool built for "S3" works with MinIO too.

**PostgreSQL (Postgres)**
The main permanent database — the "source of truth" for structured data like users, organizations, zone configurations, billing records. Unlike Redis, data here is durable (survives restarts) and never treated as disposable.

**NATS (NATS JetStream)**
A lightweight messaging system used to broadcast events between different services without them needing to know about each other directly. Example: "a cache invalidation happened" gets published once to NATS, and every Edge Proxy around the world — however many there are — hears about it and purges its own cache. This is called **pub/sub** (publish/subscribe): one part of the system *publishes* an event, and any number of other parts can *subscribe* to hear about it.

**ClickHouse**
A specialized database built for very fast analytics queries over huge amounts of data (like "how much bandwidth did zone X use last week, broken down by country?"). Regular databases like Postgres aren't great at this kind of large-scale number-crunching; ClickHouse is. **Connects to:** the Analytics Service (writes request logs here) and the dashboard (reads aggregated stats from here).

**Traefik**
A reverse proxy / API gateway that sits in front of the control plane's services and automatically routes incoming requests to the right one, and automatically sets up TLS certificates. Think of it as an automatic, self-configuring traffic director. **Connects to:** every control-plane service, and to custom domains (Traefik provisions their certificates).

### 3.4 Identity, Security, and Access

**Microservice**
A style of building software as many small, independent programs (services) that each do one job and talk to each other over the network, rather than one giant program that does everything. RivoCloud's control plane is split into ~8 microservices (Identity, CDN, Storage, Analytics, Billing, Notification, Scheduler, Dashboard) — see Section 4 below.

**API (Application Programming Interface)**
A defined way for one piece of software to ask another piece of software to do something — e.g., "create a new zone" is an API call the dashboard makes to the CDN Service. RivoCloud's APIs are **REST APIs**, a common style where each action is an HTTP request like `POST /api/v1/zones`.

**JWT (JSON Web Token)**
A digitally-signed piece of text that proves "this user is logged in as X" without the server needing to look anything up in a database on every single request — the token itself carries the proof. Used for logged-in dashboard sessions. Expires quickly (15 minutes) for security, and is refreshed using a longer-lived **refresh token**.

**API Key**
An alternative to JWT login, meant for *programmatic* access (scripts, integrations) rather than a human clicking around a dashboard. Looks like `rc_live_3qYJ...`. Can be scoped to specific permissions (e.g., "can read zones but not billing").

**RBAC (Role-Based Access Control)**
A system where each user is assigned a *role* (Owner, Admin, Developer, or Viewer), and each role has different permissions (e.g., only Owners can manage billing). **Connects to:** every control-plane service, since each one must check the caller's role before allowing an action.

**Organization (Org)**
A team/company account. Every resource (zones, buckets, billing) belongs to an organization, and organizations have multiple users (members) with different roles.

**Audit Log**
A permanent record of "who did what, when" — e.g., "user X deleted zone Y at 3:04pm." Used for security review and accountability. Written automatically whenever someone makes a change.

**Rate Limiting**
Restricting how many requests a single user/IP/API-key can make in a given time window, to prevent abuse (accidental or malicious) from overwhelming the system.

### 3.5 Deployment & Operations Concepts

**Docker**
A tool that packages an application together with everything it needs to run (code, dependencies, settings) into a single portable unit called a **container**, so it runs the same way on any machine.

**Docker Compose**
A tool for defining and running *multiple* Docker containers together as one system, described in a single configuration file. Phase 1's entire local development environment (all 8+ services plus Postgres, Redis, MinIO, etc.) is started with one command: `docker compose up`.

**Kubernetes (K8s) / k3s**
A system for running many Docker containers across multiple physical/virtual machines reliably at scale — it restarts crashed containers, spreads load across machines, and more. **k3s** is a lightweight version of Kubernetes suited for smaller setups. Phase 1 starts on plain Docker Compose (simpler) and migrates to k3s later (Month 9) once the system needs more resilience.

**CI (Continuous Integration)**
Automated checks (tests, linting, type-checking) that run every time code is proposed to be merged, to catch mistakes before they reach production.

**GitOps**
A deployment approach where the "desired state" of production infrastructure is described in files stored in a Git repository, and a tool (ArgoCD, in this project) automatically makes the real infrastructure match those files whenever they change.

**Monorepo**
Keeping the code for *all* of RivoCloud's separate services in a single Git repository (instead of one repository per service), for easier coordination.

### 3.6 The Microservices Themselves

Each of these is a small, independent program (a "service") with one clear job:

| Service | Job, in one sentence |
|---|---|
| **Identity Service** | Handles login, organizations, members, and API keys. |
| **CDN Service** | Manages zones, custom domains, cache rules, and invalidation requests. |
| **Storage Service** | Manages buckets and object metadata, and hands out presigned upload/download URLs. |
| **Analytics Service** | Collects and summarizes traffic data (bandwidth, cache hit rate, etc.). |
| **Billing Service** | Talks to Stripe (payment processor) to handle subscriptions and invoices. |
| **Notification Service** | Sends emails (and later, webhooks) when important things happen. |
| **Scheduler** | Runs recurring background jobs (cleanup, rollup calculations, cert-expiry checks). |
| **Dashboard** | The actual website (built with Next.js) that customers log into and click around. |
| **Edge Proxy** | The Go program that serves cached content to real website visitors — the Data Plane. |

---

## 4. A Concrete Walkthrough: What Actually Happens

Understanding the terms is one thing — seeing them work together is another. Here are two real flows.

### Walkthrough A: Setting up a CDN zone and serving cached content

1. A customer logs into the **Dashboard** — this calls the **Identity Service**, which checks their password and hands back a **JWT**.
2. The customer clicks "Create Zone," entering their origin URL (`https://api.customer-backend.com`). The Dashboard sends this to the **CDN Service** as an API call.
3. The CDN Service saves this as a new row in the `pull_zones` table in **PostgreSQL**, and also writes the zone's configuration into **Redis** so the Edge Proxy can find it quickly (it does not query Postgres directly — too slow for the hot path).
4. A website visitor requests `https://{zone}.cdn.rivocloud.dev/logo.png`.
5. DNS routes this request to the nearest **Edge Proxy** (at a **PoP**).
6. The Edge Proxy looks up the zone's config (checking its own memory first, then Redis) to learn the origin URL and cache rules.
7. It checks its **3-layer cache** (L1 → L2 → L3) for `logo.png`. First time: **cache miss** everywhere.
8. The Edge Proxy fetches `logo.png` from the customer's **origin**, stores a copy in L1 and L2 (Redis), and returns it to the visitor, with a header `X-RivoCloud-Cache: MISS`.
9. A second visitor requests the same image seconds later. This time it's a **cache hit** in L1 — served in under a millisecond, with `X-RivoCloud-Cache: HIT`.
10. Every request (hit or miss) is also reported asynchronously via **NATS** to the **Analytics Service**, which stores it in **ClickHouse** so the customer can see graphs of traffic later.

### Walkthrough B: Uploading a file and invalidating a stale cache

1. A customer wants to update their logo. Their app calls the **Storage Service**: "I want to upload `logo.png` to bucket X."
2. The Storage Service creates a metadata row in Postgres (`status: pending`) and asks **MinIO** for a **presigned URL** — a temporary upload link.
3. The customer's app uploads the file bytes *directly* to MinIO using that link — the Storage Service never touches the file's actual data.
4. MinIO fires a webhook back to the Storage Service: "upload complete." The Storage Service updates the metadata to `status: ready` and publishes an `object.uploaded` event to **NATS**.
5. Separately, the customer calls the CDN Service: "please invalidate the cache for `/logo.png`."
6. The CDN Service records this request in Postgres and publishes a `cache.invalidate` event to **NATS**.
7. Every **Edge Proxy**, everywhere, is subscribed to that NATS topic. Each one deletes any cached copy of `/logo.png` from its own L1 and L2 caches.
8. The next visitor gets a fresh **cache miss**, and the new logo is fetched and re-cached.

---

## 5. How Phase 1 Is Built: The 16 Stages

Phase 1 isn't built all at once — it's built in a specific order, because some pieces are needed *before* others can exist. This is what [`phase1-development-flow.md`](phase1-development-flow.md) diagrams visually. Here's the same order explained in plain language, stage by stage, with **why each one depends on the previous ones**.

1. **Infrastructure Foundation** (Month 1) — Set up the monorepo, get Docker Compose running all the databases/tools, define the PostgreSQL schema, and set up CI. *Why first:* literally nothing else can be built without a place to write code and a database to store data in.

2. **Identity Service** (Month 1) — Build login, organizations, and API keys. *Why second:* almost every other feature needs to know "who is making this request and are they allowed to do this?" Building auth once, early, means every later service can reuse it instead of reinventing it.

3. **Go Edge Proxy — Basic** (Month 2) — Build the simplest possible version: receive a request, forward it to origin, cache the result in Redis, then in an in-process LRU. *Why now:* this validates the riskiest, most important technical piece (does the caching architecture actually work?) before investing in surrounding features.

4. **CDN Service** (Month 2) — Build zone management (create/edit zones) and have it publish configuration to Redis. *Why after the Edge Proxy:* the Edge Proxy needs *something* to read its configuration from — building the proxy first (step 3) with hardcoded config, then adding real configuration management, avoids building both halves blind.

5. **Storage Service** (Month 3) — Bucket and object management, upload flow via MinIO. *Depends on:* the Identity Service (for auth) — otherwise anyone could upload/delete anyone else's files.

6. **Dashboard MVP** (Months 1–3, ongoing) — The actual web UI, built incrementally alongside each backend service (login pages once Identity exists, zone UI once CDN Service exists, storage UI once Storage Service exists). *Why it spans multiple months:* there's no point building UI for a feature that doesn't have a backend yet.

7. **NATS Invalidation** (Month 4) — Cache invalidation (purge on demand) and the cache rules engine (per-path TTL). *Depends on:* the CDN Service (to trigger invalidation) and the Edge Proxy (to receive and act on it).

8. **Custom Domains + TLS** (Month 3) — Let customers use their own domain names, with automatic certificates. *Depends on:* the CDN Service (zones must exist before you can attach a domain to one).

9. **Analytics** (Month 5) — Edge proxies emit traffic events, an Analytics Service stores them in ClickHouse, and the dashboard shows charts. *Depends on:* the Edge Proxy already running and generating real traffic to measure.

10. **Signed URLs** (Month 4) — Time-limited private download links, generated by the Storage Service and checked by the Edge Proxy. *Depends on:* the Storage Service (step 5) already existing.

11. **Security + RBAC** (Month 6) — Enforce roles/permissions everywhere, add audit logging and rate limiting. *Why this late:* it needs *all* the other services to already exist, since it adds a permission check to every one of them.

12. **Billing** (Month 7) — Stripe integration so customers can actually pay. *Depends on:* organizations existing (step 2) and usage data existing (step 9, Analytics) so usage-based limits can be enforced.

13. **Kubernetes Migration** (Month 9) — Move from simple Docker Compose to a more resilient Kubernetes setup. *Why so late:* this is a purely operational upgrade — it makes an *already-working* system more reliable, so it's deferred until the system is functionally complete.

14. **First Hetzner Edge Node** (Month 8) — Add a second physical server location. *Depends on:* everything about the Edge Proxy and NATS already working reliably in one place, before trusting it to run in two places at once.

15. **SDK + CLI** (Month 10) — Developer tools that wrap the REST API. *Depends on:* the API itself (zones, storage, invalidation) being stable, since the SDK is just a convenient wrapper around it.

16. **Public Beta** (Month 10) — Documentation, landing page, onboarding polish, and launch. *Why last:* you don't invite the public in before the product actually works end-to-end.

### The key idea behind the ordering

Notice the repeating pattern: **foundation → core mechanism → management layer → polish layer**, applied to each area, and always in an order where an earlier stage supplies something a later stage needs. For example, you can't build "cache invalidation" (stage 7) before you have an Edge Proxy that caches things (stage 3) and a CDN Service that manages zones (stage 4) — invalidation is meaningless without both of those existing first.

---

## 6. Quick Reference: How Things Connect

```
Visitor's browser
      │
      ▼
  Edge Proxy (Go) ───reads config from──▶ Redis ◀──writes config──── CDN Service
      │        │                                                          │
      │        └──fetches files from──▶ MinIO ◀──manages metadata──── Storage Service
      │        └──forwards cache misses to──▶ Customer's Origin Server
      │        └──sends traffic events to──▶ NATS ──▶ Analytics Service ──▶ ClickHouse ──▶ Dashboard charts
      │        └──listens for invalidation events on──▶ NATS ◀──publishes── CDN Service
      ▼
  Response back to visitor

Dashboard (Next.js) ──logs in via──▶ Identity Service ──stores sessions in──▶ Redis
      │                                    │
      │                                    └──stores users/orgs in──▶ PostgreSQL
      │
      ├──manages zones via──▶ CDN Service ──stores zone data in──▶ PostgreSQL
      ├──manages files via──▶ Storage Service ──stores metadata in──▶ PostgreSQL
      ├──views usage via──▶ Analytics Service ──reads from──▶ ClickHouse
      └──manages payment via──▶ Billing Service ──talks to──▶ Stripe
```

**The one-line summary:** Postgres and MinIO hold the durable truth; Redis and NATS are the fast, disposable glue that lets the Edge Proxy stay fast without constantly asking the control plane for permission; and every control-plane microservice owns one narrow slice of that truth, coordinating through NATS events instead of calling each other directly.
