# CDN Zones & Configuration — Explained for Beginners

This document explains the concepts behind **Stage 4: CDN Service**, the next stage in RivoCloud's [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages). Stage 4 has **not been built yet** — this is preparation reading, so the ideas are already familiar once work on it starts.

If you haven't read them yet, read these first:

- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — explains what a "zone" is at a glossary level, and the Control Plane vs. Data Plane split this whole stage is built around.
- [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) — the style/depth template this document follows, and where Postgres, Redis, and NATS come from.

This document goes deeper than the glossary: it explains *why* a zone is structured the way it is, and — the single most important idea in this stage — *why* the CDN Service writes zone configuration into Redis instead of the Edge Proxy asking Postgres directly.

---

## 1. What Stage 4 actually is

Per the [PRD roadmap](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap) and the [EDD's Development Order](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#11-development-order), Stage 4 is the **CDN Service**, a NestJS microservice, and it does two things:

1. **4.1 — Zone CRUD**: let a user create, read, and update a "zone" (the configuration record for one CDN-cached site/API), storing it in PostgreSQL.
2. **4.2 — Zone config publication to Redis**: whenever a zone is created or changed, write its configuration into Redis, so the already-running Edge Proxy (Stage 3) can pick up the change.

That's it — this stage does not yet build custom domains, cache rules, or invalidation (those are Stages 7 and 8). It builds the *foundation record* that every one of those later features will attach to.

---

## 2. What a zone configuration record actually contains

The glossary entry for "Zone (Pull Zone)" says a zone is "a configuration record representing one website/API that RivoCloud is caching for a customer." Concretely, that record is the `pull_zones` table (EDD Section 6.2). Here's what each column means and why it exists:

| Column | Plain-language meaning | Why it matters |
|---|---|---|
| `id` | The zone's unique identifier (a UUID) | Every other CDN feature (domains, rules, invalidations) references a zone by this ID, not by name — names/slugs can change, IDs don't. |
| `org_id` | Which organization owns this zone | Zones are always org-scoped — a user can only see/edit zones belonging to their own organization (enforced by the auth guard from Stage 2). |
| `project_id` | Optional grouping folder within an org | Lets a customer organize many zones (e.g., "staging" vs "production") without it affecting how the zone actually behaves. |
| `name` | Human-readable label shown in the dashboard | Purely cosmetic — "My Blog CDN" is easier to recognize than a UUID. |
| `slug` | The subdomain RivoCloud gives the zone, e.g. `{slug}.cdn.rivocloud.dev` | This is how a visitor's DNS request actually reaches the zone before a custom domain (Stage 8) is attached. |
| `origin_url` | The customer's real server, e.g. `https://api.customer.com` | This is the **origin** (see the glossary) — where the Edge Proxy fetches content on a cache miss. Without this field, "origin pull" has nothing to pull from. |
| `origin_protocol` | Whether to talk to the origin over `http`, `https`, or `match` (mirror the visitor's own protocol) | Some origins only support one protocol; `match` covers origins that support both and should behave transparently. |
| `cache_ttl` | The zone's **default Edge TTL** in seconds (defaults to 3600 = 1 hour) | This is the fallback caching duration used when nothing more specific (a cache rule, Stage 7) overrides it. Every zone needs *some* default even before per-path rules exist. |
| `browser_ttl` | The default **Browser TTL** told to visitors' browsers (0 = inherit the edge TTL) | Lets a zone tell browsers to cache for a different — usually shorter — duration than RivoCloud's own edge cache, per the Edge TTL vs Browser TTL distinction in the glossary. |
| `enabled` | Whether the zone is currently active | A kill switch — a customer (or RivoCloud, e.g. for abuse) can disable a zone without deleting its configuration and history. |
| `signing_secret` | A secret used later for **Signed URLs** (Stage 10) | Present in the schema now so the column exists when that feature is built; not used by anything in Stage 4 itself. |
| `created_at` / `updated_at` | Standard audit timestamps | Lets the system (and support staff) see when a zone was created or last changed. |

### Why the zone is the "container" everything else attaches to

Look at the other CDN tables in EDD Section 6.2 — `zone_domains`, `cache_rules`, and `cache_invalidations` — and notice they all have a `zone_id` foreign key pointing back at `pull_zones.id`:

```
pull_zones (id, org_id, origin_url, cache_ttl, browser_ttl, enabled, ...)
    │
    ├── zone_domains        (zone_id → pull_zones.id)   "which custom domains point at this zone"      — built in Stage 8
    ├── cache_rules          (zone_id → pull_zones.id)   "per-path TTL / bypass overrides for this zone" — built in Stage 7
    └── cache_invalidations  (zone_id → pull_zones.id)   "purge history for this zone"                  — built in Stage 7
```

None of those tables make sense without a zone already existing — a custom domain has to point *at something*, a cache rule has to override *some zone's* default TTL, an invalidation has to purge *some zone's* cached content. That's the literal database reason a zone is "the container": every later feature is a row that references a zone, never the other way around. This is also why Stage 4 (the zone itself) has to be built before Stage 7 (cache rules/invalidation) and Stage 8 (custom domains) — you cannot attach a shelf bracket to a wall that hasn't been built yet.

---

## 3. CRUD, for a complete beginner

**CRUD** stands for **C**reate, **R**ead, **U**pdate, **D**elete — the four basic operations almost any system performs on a stored record. It's not CDN-specific; it's how nearly all software manages data. Applied to zones, per the API design in EDD Section 7.5:

| Operation | What it means for a zone | Endpoint |
|---|---|---|
| **Create** | A user submits an origin URL (and optionally a name, TTL, etc.); the CDN Service validates it and inserts a new row into `pull_zones`. | `POST /api/v1/zones` |
| **Read** | Fetch one zone's details, or list every zone belonging to the caller's organization. | `GET /api/v1/zones/:zoneId`, `GET /api/v1/zones` |
| **Update** | Change an existing zone's origin URL, default TTL, or other settings — without needing to delete and recreate it. | `PATCH /api/v1/zones/:zoneId` |
| **Delete** | Remove a zone's configuration entirely. | `DELETE /api/v1/zones/:zoneId` |

The EDD's Stage 4 build-order entry (Section 11, "4.1 Zone CRUD") specifically calls out **create, read, update** as the Stage 4 deliverable — the API design in Section 7.5 also lists a `DELETE` route as part of the same CDN Service surface, but the create/read/update trio is the part this stage is explicitly scoped to land first. The point of naming this "CRUD" at all, rather than just "an API," is that it's a *recognizable pattern*: once you understand that a zone is "a record with Create/Read/Update/Delete operations," you already understand the shape of nearly every other resource in RivoCloud (buckets, cache rules, API keys, organizations) before reading a single line of their code.

---

## 4. The single most important idea: why Redis, not Postgres, on every request

This is the idea the whole stage exists to teach. Skimming past it is the easiest way to misunderstand this entire service.

### The problem

Once a zone exists, the Edge Proxy needs to know its configuration (origin URL, default TTL, whether it's enabled) on **every single incoming request** — potentially thousands of requests per second, from visitors all over the world, at PoPs the CDN Service itself doesn't run inside of. If the Edge Proxy queried PostgreSQL directly for that config on every request, three things would go wrong:

1. **Latency.** A network round-trip to a relational database, even a fast one, typically costs single-digit milliseconds. Per the [Non-Functional Requirements in the PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#6-non-functional-requirements), an L1/L2 cache hit is supposed to be served in under 1 millisecond. A Postgres round-trip on the hot path would blow that budget before the Edge Proxy has even started deciding whether the actual *content* is cached.
2. **Load.** Postgres is built to be the durable, correct source of truth — not to answer millions of repeated identical reads per second from every Edge Proxy replica at every PoP, all day. That's a connection-pool and query-load problem waiting to happen, and it would compete with the CDN Service's own (already rare) writes.
3. **Coupling of availability.** If the Edge Proxy needed Postgres to serve a request, then a control-plane database blip (a slow migration, a maintenance restart) would take down live customer traffic — coupling something that "can be a little slow without anyone noticing" (the control plane) to something that "must be near-instant" (the data plane). Re-read the Control Plane vs. Data Plane split in [Section 2 of phase1-explained-for-beginners.md](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds) — this is exactly the failure mode that split is designed to prevent.

### The solution: Redis as the hand-off point

Per EDD Section 2.3 (CDN Service responsibilities) and Section 2.1 (Edge Proxy zone config loading), the fix is that the CDN Service — not the Edge Proxy — is responsible for pushing zone configuration into Redis whenever it changes:

- The CDN Service writes each zone's config into Redis as JSON, under a key shaped like `zone_config:{zone_id}` (EDD Section 2.1).
- The Edge Proxy reads that same key. It never queries Postgres for zone config at all on the hot path — per the EDD, the *only* time it talks to the Control Plane API directly is once, at startup, to bulk-sync all active zone configs into Redis before it starts serving traffic ("not on the hot path").
- To avoid even a Redis round-trip on every request, the Edge Proxy caches the config **in its own process memory for 60 seconds** (EDD Section 2.1) — this is a *second*, small cache sitting in front of Redis, specifically for config, not to be confused with the L1/L2/L3 content cache described in the beginner glossary.
- When a zone changes, the CDN Service also publishes a NATS message on the `config.zones.updated` topic so already-running Edge Proxies refresh that one zone's config sooner than 60 seconds — but per the EDD, this is described as "a faster-than-TTL invalidation signal, not the only delivery path." **Redis is the authoritative config source; NATS is just a way to hear about changes faster.** If a NATS message is ever missed, the 60-second in-process TTL is the safety net that guarantees the Edge Proxy eventually notices anyway.

Conceptually, illustrating what that Redis-stored JSON blob would carry (built from the `pull_zones` columns in Section 2 above — the EDD does not spell out the exact JSON field names, only that it's "config structure stored as JSON"):

```
zone_config:8f14e45f-...  (Redis key)
{
  "id": "8f14e45f-...",
  "orgId": "...",
  "slug": "my-blog",
  "originUrl": "https://api.customer.com",
  "originProtocol": "https",
  "cacheTtl": 3600,
  "browserTtl": 0,
  "enabled": true
}
```

The Edge Proxy reads exactly this — a flat key-value lookup, no joins, no SQL, no schema knowledge of Postgres at all — which is what makes sub-millisecond reads realistic.

### Why this is the "control plane vs. hot path" argument in miniature

| | Querying Postgres directly (rejected) | Publishing to Redis (the actual design) |
|---|---|---|
| Who pays the cost of a slow read? | Every visitor, on every request | Nobody — the write happens once, at zone-change time, which is rare |
| What happens if the CDN Service (NestJS) crashes? | Immediate: no zone lookups possible, live traffic breaks | Nothing, in the short term — Redis (and the 60s in-process cache) still holds the last-known-good config |
| What does the Edge Proxy need to know about Postgres? | Its schema, credentials, connection pooling | Nothing — it never connects to Postgres at all |
| Matches the PRD's <1ms L1/L2 latency requirement? | No | Yes |

This table is really just the Control Plane/Data Plane table from [phase1-explained-for-beginners.md Section 2](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds) applied to one specific decision. Every time you see "the CDN Service writes to Redis" in this stage, that's this argument playing out.

---

## 5. How the CDN Service and Edge Proxy talk without calling each other's APIs

This is worth stating explicitly because it's easy to assume two services that depend on each other must call one another's HTTP APIs directly. They don't, here:

- The **CDN Service** (control plane, NestJS, built this stage) never calls the Edge Proxy's API, and doesn't need to know how many Edge Proxy replicas exist, or where they're running.
- The **Edge Proxy** (data plane, Go, built in Stage 3) never calls the CDN Service's API on the hot path — only once at startup, to bootstrap its Redis cache.
- **Redis is the shared, asynchronous hand-off point.** The CDN Service writes; the Edge Proxy reads. Neither needs to know the other exists as a running program — only that a particular Redis key convention (`zone_config:{zone_id}`) is the shared contract between them.
- **NATS is the notification layer** riding alongside Redis, telling already-running Edge Proxies "something changed, go re-read Redis sooner" — again, without either service directly addressing the other.

This is the same pattern already used elsewhere in RivoCloud (per the Quick Reference diagram in [phase1-explained-for-beginners.md Section 6](../phase1-explained-for-beginners.md#6-quick-reference-how-things-connect)): services coordinate through shared, fast infrastructure (Redis, NATS) instead of direct service-to-service API calls. It keeps each service independently deployable — you can restart, scale, or even briefly take down the CDN Service without the Edge Proxy noticing, because the Edge Proxy was never talking to it directly in the first place.

```
                     ┌───────────────────────┐
                     │   CDN Service (NestJS)│   Control Plane
                     │   Stage 4              │
                     └───────────┬───────────┘
             writes zone row     │      writes JSON config
             on Create/Update    │      on every zone change
                     ▼           │
             ┌───────────────┐   │        publishes
             │  PostgreSQL   │   └──────▶ "config.zones.updated"
             │  pull_zones   │            on NATS
             └───────────────┘                │
                                               │ (fast-path nudge)
                     ┌─────────────────────────▼─────┐
                     │           Redis               │
                     │   zone_config:{zone_id}  (JSON)│
                     └───────────────┬────────────────┘
                                     │ read (in-process cached 60s)
                                     ▼
                     ┌───────────────────────┐
                     │  Edge Proxy (Go)      │   Data Plane
                     │  Stage 3               │
                     └───────────┬───────────┘
                                 │ serves cached/fetched content using
                                 │ the origin URL + TTL it just read
                                 ▼
                          Website visitor
```

---

## 6. Concrete walkthrough: creating a zone and seeing it take effect

This expands on Walkthrough A in [phase1-explained-for-beginners.md Section 4](../phase1-explained-for-beginners.md#walkthrough-a-setting-up-a-cdn-zone-and-serving-cached-content), focusing specifically on what happens *inside* Stage 4's slice of the system.

1. A logged-in user (already authenticated via the Identity Service's JWT, Stage 2) opens the dashboard and fills in a "Create Zone" form: a name and an origin URL such as `https://api.customer.com`.
2. The dashboard sends `POST /api/v1/zones` to the CDN Service, with the JWT attached.
3. The CDN Service's auth guard (built in Stage 2, reused here) checks the JWT is valid and resolves which organization the user belongs to — a zone can't be created without knowing whose organization it belongs to.
4. The CDN Service validates the request body (e.g., is `origin_url` a plausible URL?) and inserts a new row into `pull_zones` in PostgreSQL — this is the **Create** in CRUD, and it's the durable, permanent record of the zone's existence.
5. Immediately after the Postgres write succeeds, the CDN Service serializes that same zone's fields into JSON and writes it to Redis at `zone_config:{zone_id}` (Section 4.2 of the build order) — and publishes a `config.zones.updated` NATS message so any already-running Edge Proxy hears about it sooner than its 60-second refresh cycle.
6. The API responds to the dashboard with the new zone's details (its `id`, `slug`, etc.), and the dashboard shows the user their new zone, including the `{slug}.cdn.rivocloud.dev` address they can now point traffic at.
7. Minutes later, a website visitor requests `https://{slug}.cdn.rivocloud.dev/logo.png`. DNS routes this to the nearest Edge Proxy.
8. The Edge Proxy looks up the zone's config — first checking its own 60-second in-process cache, then Redis (`zone_config:{zone_id}`) if it's not there — and finds the `origin_url`, `cacheTtl`, and `enabled` fields it just received.
9. Using that config, the Edge Proxy does exactly what the glossary describes for **Origin Pull**: since this is the first request, it's a cache miss everywhere, so it fetches `logo.png` from `https://api.customer.com`, caches a copy per the zone's `cache_ttl`, and returns it to the visitor.

**The important detail:** nobody restarted the Edge Proxy, redeployed anything, or pushed a config file. The zone went from "doesn't exist" to "actively serving cached traffic" purely because a new Redis key appeared — this is exactly what the PRD's Section 5.2 functional requirement means by *"Zone configuration changes propagate to the edge proxy without a restart."*

---

## 7. Why this stage needs Stage 2 and Stage 3 to exist first

The PRD's roadmap table lists Stage 4's dependencies as **Stage 2 (Identity Service)** and **Stage 3 (Go Edge Proxy — Basic)**. Neither dependency is incidental:

- **Stage 2 (Identity Service) — the auth guard.** Every zone belongs to an organization, and every mutating call (`POST`, `PATCH`, `DELETE /api/v1/zones/...`) has to know *which* organization is making the call, and whether that user is even allowed to. That check is the auth guard built in Stage 2 (EDD Section 11, "2.4 Auth Guard (NestJS): JWT + API key middleware... all other services import this guard"). Without it already existing, the CDN Service would either have to build its own duplicate authentication logic, or — worse — skip the check and let anyone create or edit anyone else's zones. Building auth once, early, and having every later service (including this one) import it is exactly the reasoning given for building Identity Service second in [phase1-explained-for-beginners.md Section 5](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages).
- **Stage 3 (Go Edge Proxy — Basic) — something to configure.** The whole point of Stage 4 is publishing configuration *somewhere the Edge Proxy reads from*. If the Edge Proxy didn't exist yet, "publish zone config to Redis" would have no consumer to validate against, and there'd be no way to prove the hand-off actually works end-to-end. The EDD's own rationale for building the Edge Proxy before the CDN Service (Section 11, Stage 3 before Stage 4) is that it proves the riskiest, most important mechanism — the 3-layer cache — using hardcoded config first, so that Stage 4 only has to solve *one* new problem (real, dynamic configuration) instead of two unproven things at once.

In short: Stage 2 answers "is this request even allowed?" and Stage 3 answers "is there anything downstream that will actually use this configuration?" — Stage 4 can't be meaningfully tested without both answers already existing.

---

## 8. What's explicitly *not* part of this stage yet

To avoid over-claiming: Stage 4, per the EDD's own scoping, is zone CRUD (create/read/update) plus publishing that config to Redis. The `zone_domains`, `cache_rules`, and `cache_invalidations` tables already exist in the Prisma schema (built in Stage 1) and their API routes are already designed in EDD Section 7.5, but the *services* that actually populate and enforce them are later stages:

| Feature (attaches to a zone) | Table | Built in |
|---|---|---|
| Zone itself (origin, default TTL, enabled) | `pull_zones` | **Stage 4 (this stage)** |
| Custom domains + TLS certificates | `zone_domains` | Stage 8 |
| Per-path cache rules (TTL overrides, bypass) | `cache_rules` | Stage 7 |
| Cache invalidation / purge requests | `cache_invalidations` | Stage 7 |

---

## 9. One picture, one summary

```
Dashboard ──POST /api/v1/zones (JWT)──▶ CDN Service (auth-guarded, Stage 4)
                                              │
                                    validates + writes
                                              ▼
                                        PostgreSQL
                                       (pull_zones row)
                                              │
                                   publishes JSON config
                                              ▼
                                           Redis
                                  zone_config:{zone_id}
                                              │
                              (+ NATS "config.zones.updated" nudge)
                                              │
                                              ▼
                                    Edge Proxy (Stage 3)
                              reads config, no Postgres, no restart
                                              │
                                              ▼
                                     Website visitor
                                (served from cache / origin pull)
```

**The one-line summary:** a zone is nothing more than a Postgres row describing one origin and its default caching behavior, but its entire purpose is to be republished as a small JSON blob in Redis — the one artifact the Edge Proxy actually reads on every request — so that the slow, careful, auth-checked control plane (CDN Service) and the fast, always-on data plane (Edge Proxy) can each do their job without ever calling each other's API or sharing a database connection.
