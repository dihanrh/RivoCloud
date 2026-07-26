# Cache Invalidation & Messaging (NATS) — Explained for Beginners

This document explains **the concepts needed to understand Stage 7 of Phase 1 — "NATS Invalidation"** (cache invalidation + the cache rules engine), which covers Month 4 of the build order. **Stage 7 has not been built yet.** Nothing described here exists in RivoCloud's codebase today — this is a beginner's guide to the ideas *before* they're implemented, grounded entirely in the existing design docs:

- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — the glossary entries for **Cache Invalidation (Purge)**, **Cache Rules**, and **NATS**, and Walkthrough B, which this document goes much deeper than.
- [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) — briefly covers NATS's *role in the Docker Compose stack* (a pub/sub messaging system, port 4222, `-js` flag). This document goes deep on what pub/sub actually means and how invalidation uses it.
- [`../superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.5 (Cache Management requirements) and Section 7 (roadmap, Stage 7).
- [`../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 4.4 (Cache Invalidation Flow), Section 5.2 (Cache Key Design), Section 5.3 (TTL and Cache-Control Handling), Section 10 (Month 4 tasks), and Section 11.7 (NATS Invalidation, dependency order).

If you haven't read [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) yet, read it first — this document assumes you already know what a **zone**, **TTL**, **cache hit/miss**, and the **Edge Proxy** are.

---

## 1. The problem this stage solves

Every CDN's whole job is to serve cached copies of content instead of re-fetching it from origin every time. But caching creates a new problem: **what happens when the underlying content changes?**

Two mechanisms exist to keep a cache from serving outdated content forever, and Stage 7 is really about building the *second* one properly:

1. **TTL expiry (already covered by Stage 3/4)** — every cached item has a Time To Live. Once it expires, the next request is treated as a miss and re-fetched from origin. This is automatic and requires no action from the customer, but it's *slow* by design — if a zone's TTL is 7 days, stale content can be served for up to 7 days after it changed.
2. **Invalidation / purge-on-demand (Stage 7)** — a way for the customer to say "I know this specific thing changed *right now*, don't wait for the TTL." This is what this document is about.

### Why TTL alone isn't enough: the "customer just updated their content" scenario

Imagine a customer runs an e-commerce site through RivoCloud, with `/logo.png` cached at the edge for 7 days (a long TTL is normal for static assets — see [Section 4](#4-ttl-priority-cache-rules-and-why-both-are-needed) below). On Monday, their design team uploads a new logo to replace the old one.

Without invalidation, every visitor around the world would keep seeing the *old* logo for up to 7 more days, until each edge's cached copy naturally expires. The customer has no lever to pull — they'd have to wait, or the CDN would have to intentionally cripple its caching by using tiny TTLs for everything, which defeats the entire purpose of a CDN (fast, cheap, low-origin-traffic delivery).

**Cache invalidation (purge)** is that lever: an explicit "forget your cached copy of X, it's stale now" signal the customer (or the CDN Service itself, e.g., after detecting an object was re-uploaded) can trigger on demand. Per the [PRD Section 5.5](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md):

> On-demand cache invalidation (purge) by path pattern or tag, reflected across every edge proxy within seconds via NATS.

The key phrase is "across every edge proxy" — a customer's content isn't cached in one place, it's potentially cached at every PoP (Point of Presence) running an Edge Proxy, anywhere in the world. Stage 7's real engineering problem isn't "how do I delete one cache entry" (that's a one-line operation) — it's **"how do I reliably tell an unknown, possibly-growing number of independent Edge Proxy processes, scattered across the planet, to each delete their own copy of the same thing, within seconds, without the CDN Service needing to know or track exactly which proxies exist"**. That's what NATS is for.

---

## 2. Pub/sub messaging, in depth

### 2.1 The naive approach, and why it doesn't scale

Suppose RivoCloud didn't use a messaging system at all. How would the CDN Service tell every Edge Proxy to purge `/logo.png`?

The naive approach: the CDN Service would need to keep a list of every single Edge Proxy's network address, then loop over that list and send each one an HTTP request ("hey, purge this path"). This has real problems:

- The CDN Service now has to **track proxy inventory** — every time a new PoP comes online (Stage 14 adds a second one in Month 8) or a proxy process restarts, that list has to be kept perfectly up to date, or some proxies silently never get the message.
- If one proxy is slow or temporarily unreachable, does the CDN Service retry it? Wait for it? Give up? This coupling means the CDN Service's invalidation logic has to know about the *operational reality* of every Edge Proxy individually.
- It doesn't scale: 3 proxies today, but the master architecture's long-term vision is many PoPs worldwide. A loop making N HTTP calls gets slower and flakier as N grows.

### 2.2 What "publish" and "subscribe" actually mean

**Pub/sub (publish/subscribe)** flips this around entirely. Instead of one service calling many others directly, everyone talks through a shared middleman — here, **NATS**:

- **Publish**: a service announces "here is a fact/event" onto a named **subject** (NATS's word for a topic/channel), without addressing it to anyone in particular. The CDN Service publishes to the subject `cache.invalidate.{zone_id}` and is *done* — it does not wait to find out who (if anyone) received it, and it does not need a list of recipients.
- **Subscribe**: a service tells NATS "I'm interested in messages published to this subject." Every Edge Proxy process, when it starts up, subscribes to `cache.invalidate.*` (the `*` is a wildcard meaning "any zone ID"). From that point on, NATS forwards every matching published message to it automatically.

The crucial property: **the publisher (CDN Service) and the subscribers (Edge Proxies) never need to know about each other.** The CDN Service doesn't know how many Edge Proxies exist, where they're running, or whether a new one just came online five seconds ago — it just publishes once. NATS handles the fan-out: if there are 3 subscribed Edge Proxies, all 3 get a copy of the message; if a 4th one is added next month at a new Hetzner PoP (Stage 14), it just subscribes to the same subject on startup and immediately starts receiving the same events, with **zero changes required in the CDN Service's code**.

This is the same pattern already used elsewhere in the system (see the NATS glossary entry and Walkthrough A in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#4-a-concrete-walkthrough-what-actually-happens)) — Edge Proxies also *publish* traffic events (`edge.request`) for the Analytics Service to *subscribe* to, entirely decoupled in the same way.

### 2.3 Why this specific decoupling matters for invalidation

Think about what "one edge proxy" really means operationally: it's not a single fixed thing. Proxy processes restart during deploys, new PoPs come online (Month 8), and eventually the master architecture's roadmap adds many more. If invalidation worked by direct HTTP calls, *every* one of those operational changes would require updating some registry of "known proxies to notify." With pub/sub:

- A brand-new Edge Proxy, from the second it subscribes to `cache.invalidate.*`, is automatically part of the invalidation system — no registration step, no code change in the CDN Service.
- The CDN Service's job shrinks to exactly one responsibility: publish the fact that something changed. It has zero responsibility for delivery mechanics.
- Because NATS JetStream (the durable variant of NATS enabled from Phase 1 — see the EDD, Section 2.1) provides **at-least-once delivery**, an Edge Proxy that's briefly disconnected still receives the event once it reconnects, instead of silently missing it forever.

### 2.4 NATS subjects used in this stage

| NATS subject | Published by | Subscribed by | Payload (per EDD Section 4.4) |
|---|---|---|---|
| `cache.invalidate.{zone_id}` | CDN Service | Every Edge Proxy | `{ zone_id, patterns, tags, invalidation_id }` |
| (reply, via NATS request/reply) | Each Edge Proxy | CDN Service | `{ datacenter, keys_purged, duration_ms }` |

Note the subject includes the zone ID (`cache.invalidate.{zone_id}`, not just `cache.invalidate`) — every Edge Proxy subscribes with a wildcard (`cache.invalidate.*`) so it hears invalidations for *all* zones it might be caching content for, but the zone ID in the subject lets tooling and logs filter to one zone's invalidation traffic specifically.

The reply is a NATS **request/reply** pattern layered on top of plain pub/sub: the CDN Service doesn't just fire-and-forget, it also *waits* (up to 5 seconds, per the EDD) to collect replies from however many Edge Proxies responded, so it can report back "3 edges notified, 3,456 keys purged" — see the walkthrough in [Section 5](#5-concrete-walkthrough-invalidating-logopng) below.

### 2.5 Why NATS (a message bus), not just a database

It's worth being explicit about why this uses a messaging system instead of, say, Edge Proxies periodically polling a Postgres table for "new invalidations." A messaging system pushes events the instant they happen (the EDD notes events propagate in ~1 second), rather than making every subscriber repeatedly ask "anything new yet?" — which would add latency (up to the length of the polling interval) and load (constant redundant queries) for no benefit. Postgres remains the durable *record* of what was requested (see [Section 5](#5-concrete-walkthrough-invalidating-logopng)); NATS is purely the fast delivery mechanism layered on top.

---

## 3. Cache rules engine: per-path TTL configuration

Cache invalidation handles "purge this *specific* thing right now." The **cache rules engine** handles a related but different problem: "for *this whole category* of URLs, always behave this way" — configured once, applied automatically to every matching request from then on, no manual action needed per request.

### 3.1 The problem: one TTL per zone isn't enough

A zone has a single default TTL (`pull_zones.cache_ttl` in the schema — see the EDD, Section 6.2). But real websites aren't uniform:

- `/api/*` — dynamic API responses that change per request. Caching these at all would serve stale or wrong data to different users. This needs TTL 0 (bypass caching entirely).
- `/assets/*.js`, `/assets/*.css` — bundled, versioned static files that never change once published (a new deploy gets a new filename/hash). These can safely be cached for a very long time, e.g., a year.
- Everything else — probably fine with the zone's default TTL.

A **cache rule** is a per-zone record that says "URLs matching this pattern get this specific behavior," overriding the zone default for just that slice of paths. Per the EDD's `cache_rules` table (Section 6.2), each rule has:

| Field | Meaning |
|---|---|
| `pattern` | The path pattern to match, e.g. `/api/*` or `/assets/*.js` |
| `pattern_type` | How to interpret the pattern: `glob` (default), `regex`, or `exact` |
| `action` | What to do on a match: `cache`, `bypass` (never cache, always hit origin), or `no-store` |
| `edge_ttl` | How long to cache at the edge, in seconds (`NULL` = fall back to the zone default) |
| `browser_ttl` | The `max-age` told to the visitor's *browser*, independent of edge TTL |
| `query_string` | How to normalize query parameters for this pattern: `strip_all`, `whitelist`, or `include_all` (see the cache key discussion below) |
| `priority` | Higher number = evaluated first, when more than one rule could match the same path |

### 3.2 Glob pattern matching

A **glob pattern** is a simple wildcard syntax — much simpler than full regular expressions — where `*` means "match any characters." `/assets/*.js` matches `/assets/app.js` and `/assets/vendor/bundle.js`, but not `/assets/app.css`. `/api/*` matches anything under `/api/`, like `/api/users` or `/api/orders/42`. This is the *default* pattern type (`pattern_type: 'glob'`); the schema also allows `regex` for more precise matching and `exact` for a single literal path, but glob covers the overwhelmingly common case ("everything under this folder").

The same glob-matching logic is reused for invalidation itself (Section 4.4 of the EDD: "For each pattern: glob-match against L1 keys → delete"), so a customer invalidating `/assets/*` purges every cached asset under that path in one call, exactly the same way a cache rule targeting `/assets/*` applies to every request under that path.

### 3.3 Priority ordering: what happens when multiple rules could match

Because patterns can overlap, the same request path might match more than one rule. Example: a zone has both a rule for `/assets/*` (cache 30 days) and a more specific rule for `/assets/*.js` (cache 365 days, because JS bundles are version-hashed and truly immutable). A request for `/assets/app.js` matches *both*.

The `priority` field (EDD: "higher = evaluated first") resolves this ambiguity: rules are evaluated in priority order, and the **first matching rule wins** — its `action`, `edge_ttl`, `browser_ttl`, and `query_string` mode are applied, and no further rules are checked. This is why the PRD's Month 4 dashboard task explicitly includes "drag-to-reorder" for cache rules (EDD Section 10, Month 4) — reordering rules in the UI is really reordering their `priority` values, letting an operator say "check the more specific `.js` rule before the general `/assets/*` rule."

### 3.4 Where the cache rules engine actually runs

Per the EDD (Section 11.7.2): "Cache rules engine (edge proxy + CDN Service)." The split matches the Control Plane / Data Plane division from [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds):

- The **CDN Service** (control plane) lets a customer create, edit, reorder, and delete cache rules via the REST API (`POST/GET/PATCH/DELETE /api/v1/zones/:zoneId/rules`, plus `POST .../rules/reorder` — EDD Section 7.5), and stores them durably in Postgres.
- The **Edge Proxy** (data plane) is what actually *evaluates* the rules, on every single incoming request, to decide the TTL and whether to bypass the cache — the same way it already reads zone configuration (Stage 4). This has to be blazing fast (matching the Data Plane's whole reason for existing), so rules need to reach the Edge Proxy through the same fast config-distribution path already used for zone settings (Redis, refreshed via NATS `config.zones.updated` events per the EDD) rather than a live Postgres query per request.

---

## 4. TTL priority: cache rules and why both are needed

It's worth connecting cache rules back to the full TTL decision an Edge Proxy makes for *any* cached response — this is the EDD's Section 5.3 priority hierarchy, and it explains exactly where cache rules slot in relative to what the origin server itself says:

| Priority | Source | Example |
|---|---|---|
| 1 (highest) | **Zone cache rule match** | `/api/*` → `edge_ttl: 0` (bypass) |
| 2 | Origin's `Cache-Control: max-age=N` header | Origin says cache for 3,600s |
| 3 | Origin's `Expires:` header (legacy fallback) | — |
| 4 | Zone default TTL | `pull_zones.cache_ttl`, e.g. 3600s |
| 5 (lowest) | Content-type based default | images: 7d, HTML: 5m, other: 1h |

Per the EDD: "There is no separate 'RivoCloud edge TTL override' distinct from cache rules. Cache rules ARE the mechanism for operator-defined TTL overrides." In other words, a cache rule isn't just one more input alongside the origin's own headers — it's designed to be the operator's way of *overriding* what the origin says, when the operator (the customer) knows better than their own server's default headers. This is also why cache rules and invalidation are built together in the same stage: rules decide *how long* something is cached by default, and invalidation is the escape hatch for *the specific moments a rule's normal TTL isn't good enough* (content changed unexpectedly).

---

## 5. Invalidation by path pattern vs. invalidation by tag

The invalidation request body (EDD Section 4.4) accepts *both* at once:

```
POST /api/v1/zones/{zone_id}/cache/invalidate
Body: { patterns: ["/assets/*", "/index.html"], tags: ["blog-post-123"] }
```

**Path pattern invalidation** is the simpler, more literal case: "purge every cached entry whose URL matches this glob." It works well when the customer knows exactly which URLs changed — e.g., they know `/logo.png` changed, so they invalidate `/logo.png` directly.

**Tag-based invalidation** solves a harder problem: sometimes a single piece of content is cached under *many different URLs*, and the customer doesn't know (or shouldn't need to know) all of them. Classic example: a blog post titled "blog-post-123" might appear on its own page (`/posts/blog-post-123`), on a category listing page (`/category/tech`), on the homepage (`/`), and in an RSS feed (`/feed.xml`) — four different cached URLs, all of which need to be purged the moment that one blog post is edited. Asking the customer to enumerate all four exact paths (and keep that list correct as the site's structure changes) is fragile and easy to get wrong. Instead, if every cached response related to that blog post was tagged `blog-post-123` when it was cached, the customer can invalidate by that one tag and every associated cache entry — regardless of URL — is purged in one call.

This is listed as a **P1 (Month 4) feature** in the EDD's feature checklist ("Cache invalidation by tag"), alongside pattern-based invalidation. The `cache_invalidations` audit table (EDD Section 6.2) already has a `tags TEXT[]` column ready to record which tags were requested, and the same NATS event payload carries `tags` through to Edge Proxies alongside `patterns`. The exact mechanism an Edge Proxy will use to look up "which of my cached keys carry tag X" (e.g., a secondary Redis index mapping tags → cache keys, populated at cache-write time) is an implementation detail for whoever builds Stage 7 — the EDD establishes the requirement and the data shapes, not the internal indexing structure, so treat that specific detail as still to be designed, not yet decided.

---

## 6. Concrete walkthrough: invalidating `/logo.png`

This expands Walkthrough B from [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#walkthrough-b-uploading-a-file-and-invalidating-a-stale-cache) with the mechanics from the EDD's Section 4.4.

```
 Customer / Dashboard
        │
        │ 1. POST /api/v1/zones/{zone_id}/cache/invalidate
        │    { patterns: ["/logo.png"], tags: [] }
        ▼
 ┌─────────────────────┐
 │   CDN Service        │  2. INSERT INTO cache_invalidations
 │  (control plane)      │       (zone_id, patterns, tags, status='pending')
 └─────────┬────────────┘
           │ 3. NATS publish: "cache.invalidate.{zone_id}"
           │    { zone_id, patterns: ["/logo.png"], tags: [], invalidation_id }
           ▼
   ┌───────────────┐         (fan-out: one publish, many subscribers,
   │     NATS      │          CDN Service never enumerates them)
   └───┬───────┬───┘
       │       │
       ▼       ▼                     ...however many are running
 ┌──────────┐ ┌──────────┐
 │Edge Proxy│ │Edge Proxy│  4. Each one independently:
 │  (PoP A) │ │  (PoP B) │     - glob-matches "/logo.png" against its L1 (in-process) keys → deletes matches
 └────┬─────┘ └────┬─────┘     - SCANs its L2 (Redis) for matching keys → deletes matches
      │            │           - NATS reply: { datacenter, keys_purged, duration_ms }
      └─────┬──────┘
            ▼
 ┌─────────────────────┐
 │   CDN Service        │  5. Waits up to 5s collecting replies, then:
 │                       │     UPDATE cache_invalidations
 │                       │       SET status='completed', edges_notified=2,
 │                       │           keys_purged=<sum>, completed_at=now()
 └─────────┬────────────┘
           │ 6. Customer polls (or a future webhook):
           │    GET /api/v1/zones/{zone_id}/cache/invalidations/{id}
           │    → { status: "completed", edgesNotified: 2, keysPurged: 2 }
           ▼
     Next visitor requests /logo.png
           │
           ▼
     Cache MISS at every PoP (both L1 and L2 were purged)
     → Edge Proxy re-fetches the new logo from origin
     → caches the fresh copy
     → visitor gets the updated logo, without waiting for the old 7-day TTL
```

Step-by-step, matching what each piece is responsible for:

1. **Customer action** — via the Dashboard or API directly, the customer (or an automated integration) calls the invalidation endpoint with the path(s) and/or tag(s) that changed.
2. **CDN Service records intent durably** — before anything else happens, the request is written to Postgres as a row in `cache_invalidations` with `status: 'pending'`. This means even if every Edge Proxy were temporarily unreachable, there's a durable record that an invalidation was *requested*, and its outcome can be checked and retried later. Postgres is the permanent source of truth; NATS is the fast delivery layer riding on top of it (same division of labor as the rest of the system — see the [quick reference diagram](../phase1-explained-for-beginners.md#6-quick-reference-how-things-connect)).
3. **CDN Service publishes, once** — a single NATS publish to `cache.invalidate.{zone_id}`. The CDN Service's job ends here; it does not loop over Edge Proxies or track who's listening (see [Section 2](#2-pubsub-messaging-in-depth)).
4. **Every subscribed Edge Proxy reacts independently** — each one purges its *own* copies from its own L1 (in-process LRU) and L2 (local Redis) caches (see the 3-layer cache glossary entry), then replies over NATS with how many keys it purged and how long it took. Proxies don't coordinate with each other — each is only responsible for its own cache.
5. **CDN Service aggregates and finalizes** — after waiting a short window (5 seconds, per the EDD) for replies, it updates the invalidation record to `completed`, with a tally of how many edges responded and how many keys were purged in total. This tally is also how an operator would notice if, say, only 2 of 3 known edges replied — a signal worth investigating operationally, even though the invalidation already reached the edges that did reply.
6. **Customer checks the result** — by polling the invalidation-status endpoint (a webhook is mentioned as a future/alternative option in the EDD, not committed for Phase 1).
7. **The payoff** — the *next* request for `/logo.png`, from anywhere, is a guaranteed cache miss (nothing left to hit), so it gets re-fetched from origin and re-cached fresh — exactly the CDN's normal miss-then-cache behavior, just triggered on demand instead of by TTL expiry.

---

## 7. Why this stage depends on Stage 3 (Edge Proxy) and Stage 4 (CDN Service)

The [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages) and the [PRD's roadmap table](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) both list Stage 7 as depending on Stage 4, which itself depends on Stages 2 and 3. Concretely, per the EDD's Section 11.7:

> 7.1 Cache invalidation endpoint + NATS publish — **Depends: 4.1, NATS, edge proxy running**
> 7.2 Cache rules engine (edge proxy + CDN Service) — **Depends: 7.1, Prisma schema (cache_rules)**

Two dependencies, and both are load-bearing, not incidental:

- **The CDN Service (Stage 4) must exist first, because invalidation and rules are meaningless without zones to attach them to.** A cache rule is a row referencing `zone_id` (foreign key to `pull_zones`); an invalidation request is scoped to a specific zone (`POST /zones/:zoneId/cache/invalidate`). Without Stage 4 having already built zone management (creating/editing zones, publishing their config), there would be no zone record to invalidate against and no `cache_rules`/`cache_invalidations` tables' foreign key target to point at.
- **The Edge Proxy (Stage 3) must exist first, because there is nothing to purge otherwise.** Cache invalidation's entire purpose is deleting cached entries from somewhere — the Edge Proxy's L1 (in-process LRU) and L2 (Redis) caches. Stage 3 is what builds those caches and the logic that populates them in the first place (basic origin-pull caching). Without a working cache to begin with, "purge the cache" is an operation with nothing to operate on — and equally, without the Edge Proxy already running and subscribing to NATS, there'd be no subscriber on the other end of `cache.invalidate.*` to receive the event at all.

This is the same "foundation → core mechanism → management layer" pattern noted in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering): you cannot build a management/control feature (invalidation, rules) for a mechanism (caching) that doesn't exist yet. Stage 7 is explicitly the "management layer" for the caching mechanism Stages 3–4 already established.

---

## 8. Cross-references

- Full glossary and Walkthrough B: [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#31-cdn-concepts) — see the **Cache Invalidation (Purge)**, **Cache Rules**, and **NATS (NATS JetStream)** entries, and [Walkthrough B](../phase1-explained-for-beginners.md#walkthrough-b-uploading-a-file-and-invalidating-a-stale-cache).
- Docker Compose / how NATS is actually started locally: [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md#4-the-rivocloud-stack-service-by-service) (the `nats` service row, `-js` JetStream flag).
- Product requirements for this stage: [`2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md), Section 5.5 (Cache Management) and Section 7 (roadmap table, row 7).
- Full engineering design: [`2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md), Section 4.4 (Cache Invalidation Flow), Section 5.2 (Cache Key Design), Section 5.3 (TTL and Cache-Control Handling), Section 6.2 (`cache_rules` / `cache_invalidations` schema), Section 7.5 (REST endpoints), Section 10 (Month 4 tasks), Section 11.7 (dependency order).
- Once Stage 7 actually begins implementation, it will get its own detailed engineering plan under `docs/superpowers/plans/`, following the pattern of [`2026-07-18-phase1-stage1-infrastructure-foundation.md`](../superpowers/plans/2026-07-18-phase1-stage1-infrastructure-foundation.md).

**The one-line summary:** NATS lets the CDN Service announce "this cache is invalid" exactly once, without knowing or caring how many Edge Proxies are listening or where they run; cache rules give every zone fine-grained, priority-ordered control over *default* TTL behavior per path; and invalidation-by-pattern-or-tag is the on-demand override for the moments a customer can't wait for that default TTL to expire on its own.
