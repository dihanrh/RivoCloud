# Edge Proxy & Caching — Explained for Beginners

This document explains the concepts behind **Stage 3: Go Edge Proxy (Basic)** — the third stage of Phase 1's [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages). **Nothing in this document has been built yet.** Its job is to make sure every concept needed to understand the Edge Proxy is clear *before* a single line of Go code is written.

If you haven't read them yet, start with:
- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — especially [Section 3.1 (CDN Concepts)](../phase1-explained-for-beginners.md#31-cdn-concepts) and [Walkthrough A](../phase1-explained-for-beginners.md#4-a-concrete-walkthrough-what-actually-happens), which introduce the Edge Proxy and the 3-layer cache at a glossary level. This document goes *deeper* on those same ideas — it doesn't repeat them, it explains the "why" and "how" underneath them.
- [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) — explains Redis itself (the tool). This document explains how the Edge Proxy *uses* Redis, on top of that.

The engineering source of truth for everything here is [`2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Sections 2.1 and 5), and the roadmap entry is [Stage 3 in the PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap).

---

## 1. Why is the Edge Proxy written in Go, and not TypeScript like everything else?

[Section 2 of phase1-explained-for-beginners.md](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds) already introduced the split: the **control plane** (dashboard, Identity Service, CDN Service, etc.) is TypeScript/NestJS, but the **data plane** — the Edge Proxy — is Go. Here's the reasoning behind that choice, straight from the project's own runtime comparison in [Section 5.1 of the master architecture doc](../superpowers/specs/2026-06-29-revocloud-master-architecture.md#51-data-plane-runtime-go-vs-nodejs-vs-rust):

| | Go | Node.js | Rust |
|---|---|---|---|
| Performance | Excellent (goroutines, no GC pauses at scale) | Good (event loop, single-threaded) | Exceptional (zero GC) |
| Concurrency model | Goroutines (M:N threading) | Event loop (single thread) | Async (tokio) |
| Memory footprint | Low (~10MB idle) | Medium (~50MB idle) | Very low |
| Production ceiling | 100k+ req/s per node | 10–20k req/s per node | 500k+ req/s per node |
| Binary deployment | Single binary, no runtime | Needs Node.js installed | Single binary |

A few of these words unpacked:

- **Concurrency** means "handling many things at once." A CDN edge server might be juggling tens of thousands of simultaneous visitor requests. Node.js handles this with a **single-threaded event loop** — it's clever and fast, but only one piece of JavaScript code actually executes at any given instant; everything else waits its turn. Go instead uses **goroutines** — extremely lightweight, independently-schedulable units of work that the Go runtime spreads across every available CPU core automatically. You can have hundreds of thousands of goroutines active at once without much overhead, which maps naturally onto "handle hundreds of thousands of concurrent HTTP connections."
- **GC (Garbage Collection)** is the automatic process of freeing memory a program no longer needs. Both Go and Node.js do this automatically (unlike Rust, which has no GC at all — a different, harder-to-program tradeoff). The important difference is *how disruptive* it is: Go's garbage collector is tuned to avoid long "stop the world" pauses even under heavy load, which matters a lot for a program that must respond in under a millisecond. A GC pause on the *dashboard* (control plane) costing 50ms is invisible to a human clicking a button. The same 50ms pause on the Edge Proxy, multiplied across thousands of requests per second, would be a real, measurable slowdown for every website visitor.
- **Single binary, no runtime** means a compiled Go program is one self-contained executable file — no separate "Node.js must be installed on this machine" requirement. This matters a lot for the Edge Proxy specifically, because it's meant to run on many physical [PoPs](../phase1-explained-for-beginners.md#33-core-infrastructure-pieces-the-ingredients) around the world (Stage 14 adds the first one, in Hetzner, Nuremberg) — fewer runtime dependencies means fewer things that can go wrong when deploying to a new server.
- Go was also chosen because the rest of the CDN/infrastructure ecosystem RivoCloud already depends on — **Traefik, MinIO, NATS, k3s** — is *itself* written in Go, giving good client libraries and a body of real-world reference code to learn from.

The master architecture doc is explicit that **Rust** would technically be the fastest choice (it's what Cloudflare uses for its own edge proxy, Pingora), but judges the productivity cost too high for this project's team size — Go is described as delivering "90% of Rust's performance with far better ergonomics." TypeScript/NestJS, meanwhile, remains the right choice for the control plane specifically *because* raw request-handling speed isn't the bottleneck there — developer productivity building 8+ microservices is.

---

## 2. What is a reverse proxy? (Before we add caching on top)

Before "caching" makes sense, it helps to understand what the Edge Proxy is even *doing* if you strip caching away entirely.

A **proxy** is any program that sits between a client and a server and relays traffic on someone's behalf. There are two directions this can go:

- A **forward proxy** sits in front of *clients*, on their behalf — e.g., a company's office network might route all employees' web browsing through one proxy server, so it can filter or log what employees access. The proxy hides the *client* from the server.
- A **reverse proxy** sits in front of *servers*, on the server's behalf. A visitor thinks they're talking directly to `cdn.customer.com`, but they're actually talking to the reverse proxy, which then talks to the real server (the [origin](../phase1-explained-for-beginners.md#31-cdn-concepts)) on the visitor's behalf. The proxy hides the *server(s)* behind it from the client.

The Edge Proxy is a reverse proxy. In its most stripped-down form — before any caching exists at all — its entire job is:

1. Accept an incoming HTTP request from a visitor.
2. Figure out which [zone](../phase1-explained-for-beginners.md#31-cdn-concepts) this request belongs to (which origin server should handle it).
3. Make a *new*, separate HTTP request to that origin server, asking for the same thing the visitor asked for.
4. Take the origin's response and relay it back to the visitor, basically unchanged.

That's it. No caching, no Redis, no LRU — just "forward the request, forward the response back." This bare-bones version is deliberately the *very first thing built* in Stage 3 (see [Section 6](#6-the-build-sequence-why-31-before-32-before-33) below for why). Once that simple relay is proven to work reliably, caching gets layered on top of it — and caching is what turns a plain reverse proxy into a CDN. Without caching, a reverse proxy adds a network hop but no speed benefit; the entire value RivoCloud provides comes from *not* forwarding every single request all the way to the origin.

---

## 3. The 3-layer cache, in depth

[phase1-explained-for-beginners.md's glossary entry](../phase1-explained-for-beginners.md#33-core-infrastructure-pieces-the-ingredients) introduces the three layers by name and rough latency. This section walks through *what actually happens, step by step*, when a request arrives and each layer misses in turn — and *why* each layer needs to exist at all instead of just using one cache.

### The core tradeoff: latency vs. capacity

Every cache technology trades off two things: how fast it is to read from, and how much it can hold. You cannot have unlimited capacity *and* sub-millisecond reads in one single storage layer — faster storage (RAM) is more expensive and more limited than slower storage (disk, or a remote object store). The 3-layer design exists specifically to get the *best of each tradeoff point*, checking the fastest/smallest option first and only paying the cost of a slower/bigger option when necessary.

| Layer | What it is | Speed | Capacity | Shared across replicas? |
|---|---|---|---|---|
| **L1** | In-process LRU cache (lives inside the Edge Proxy's own running program, in RAM) | ~0.1ms | Small (limited by one process's memory) | No — each replica has its own |
| **L2** | Local Redis (a separate process, still on the same physical [PoP](../phase1-explained-for-beginners.md#33-core-infrastructure-pieces-the-ingredients)) | ~0.5ms, typically <1ms | Larger (a dedicated cache server's RAM) | Yes — all Edge Proxy replicas in that PoP share it |
| **L3** | MinIO (object storage) or the customer's origin server | ~20–50ms (MinIO) / variable, often much slower (origin, could be anywhere on the internet) | Effectively unlimited | Yes — shared infrastructure |

### Walking through a request, layer by layer

1. **L1 check.** The Edge Proxy first looks in its own process memory — an **LRU (Least Recently Used)** cache, meaning that when it's full and a new item needs room, whatever item hasn't been accessed in the longest time gets thrown away first (see the existing glossary entry for the general idea; [`hashicorp/golang-lru/v2`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) is the concrete Go library named in the EDD for this). If the object is there, this is an **L1 hit** — the fastest possible outcome, because there's no network call at all; it's just reading from the same computer's RAM. **L1 miss** means: this specific Edge Proxy process doesn't currently have this object in memory (maybe it was never fetched, maybe it was evicted to make room for something else, maybe a *different* replica handled the request that originally cached it — remember, L1 is *not* shared).
2. **L2 check.** On an L1 miss, the proxy asks the shared Redis instance for the same PoP. This is still fast (well under a millisecond, typically), but slightly slower than L1 because it's a network round-trip to a separate process — even if that process is on the same machine or the same local network. If Redis has it: **L2 hit** — the proxy returns the object to the visitor *and* also stores a copy in its own L1, so the *next* request for the same object on this same replica becomes an L1 hit. This is the mechanism by which "hot" (frequently requested) objects gradually populate every replica's L1 cache over time.
3. **L3 check.** On an L2 miss too, there's no cached copy anywhere in this PoP. Now the proxy needs the *actual* data, and there are two possible sources depending on how the zone is configured (see [Origin Pull vs Origin Push](../phase1-explained-for-beginners.md#31-cdn-concepts) in the glossary):
   - If it's an **origin-pull** zone: the proxy makes a real HTTP request to the customer's own origin server, wherever that is on the internet.
   - If it's an **origin-push** zone: the object already lives in RivoCloud's own MinIO storage (the customer uploaded it ahead of time), so the proxy fetches it from MinIO instead of any external server.
4. Whichever L3 source answers, the proxy **populates L2 (Redis) and L1 (in-process)** with the freshly-fetched object before returning it to the visitor — so the *next* request anywhere in this PoP gets at least an L2 hit, and the next request on this exact replica gets an L1 hit.

If even L3 fails (the origin is down, or the object genuinely doesn't exist), the proxy returns whatever error is appropriate — though note the **stale-if-error** behavior described in [Section 5](#5-cache-control-etag-and-conditional-requests-what-problem-do-they-solve) below, which can mask a temporary origin outage by serving old cached content instead of an error.

### Why not just use one big cache?

Because the fastest storage (RAM inside the exact process handling the request) is also the smallest and least shareable, and the largest storage (the whole internet's worth of origin servers, or MinIO) is also the slowest. Using only L1 would mean every new Edge Proxy replica starts "cold" with nothing cached, and popular content wouldn't be shared between replicas at all. Using only L3 (skip caching entirely) would mean paying origin-fetch latency on *every single request*, defeating the entire purpose of a CDN. Layering L1 → L2 → L3 means the *overwhelming majority* of real-world requests — for content that's actually popular — get answered by the cheapest, fastest layer, while the system still has a correct (if slower) fallback for everything else.

---

## 4. Cache key construction: is `/image.png` the same thing as `/image.png?v=1`?

Before the proxy can check any of the three layers, it needs to answer a more basic question: **what "name" does it look up in the cache?** This name is called the **cache key**, and getting it wrong is one of the classic ways a CDN breaks (already flagged as a risk in the existing glossary). This section explains *how* the key is actually built.

Per the EDD, the cache key is constructed from several pieces, combined and hashed:

```
cache_key = sha256(
  zone_id + "|" +
  "GET" + "|" +                     // always "GET" — HEAD shares the same cache entry as GET
  normalized_host + "|" +           // lowercase, strip port if :80/:443
  normalized_path + "|" +           // lowercase, collapse //
  normalized_query_string + "|" +   // sort params, strip ignored params
  vary_header_values                // e.g. Accept-Language: en if Vary: Accept-Language
)
```

Two design choices worth calling out explicitly, because they answer the exact question this document promised to answer:

- **HEAD and GET share one cache entry.** An HTTP `HEAD` request asks "give me the headers you'd send for a GET, but not the body." Rather than caching HEAD responses separately (which risks the HEAD and GET entries drifting out of sync for the same URL — a real bug class), the proxy reuses the *same* cached GET entry and simply strips the body before replying to a HEAD request.
- **Query strings need normalization, and the *zone* decides how.** This is the direct answer to "should `/image.png` and `/image.png?v=1` be the same cached object or different ones?" — it depends on what the query parameter *means* for that particular zone, so RivoCloud makes it a per-zone configuration choice rather than one hardcoded rule:

| Mode | Example input | Normalized to | When you'd use it |
|---|---|---|---|
| Strip all (default for assets) | `/img.jpg?v=1&utm=email` | `/img.jpg` | Static assets where query params are just cache-busting or tracking noise — the file is identical regardless |
| Whitelist | `/search?q=cats&page=2&utm=email` (whitelist: `q`, `page`) | `/search?page=2&q=cats` | The response genuinely differs based on some params (search terms, pagination) but not others (tracking params like `utm`) |
| Include all | `/api?user=1&ts=1234567` | `/api?ts=1234567&user=1` (sorted) | Every parameter could plausibly change the response, so nothing is safe to ignore |
| Ignore specific | `/page?content=1&_ga=tracking` (ignore: `_ga`) | `/page?content=1` | Almost everything matters, except one or two known-irrelevant tracking parameters |

Note that in every mode, the parameters that *do* survive get **sorted** — `?ts=1234567&user=1` becomes `user=1&ts=1234567`. This matters because `?a=1&b=2` and `?b=2&a=1` request the exact same thing from the server's point of view, and without sorting, the cache would treat them as two different keys and store the same content twice (a cache-key bug of the same family as the `/image.png` vs `/image.png?v=1` example). "Normalizing the query string," in plain terms, just means: reduce every semantically-equivalent URL down to one canonical, consistent string before it's used as a lookup key.

---

## 5. Cache-Control, ETag, and conditional requests: what problem do they solve?

The existing glossary defines `TTL`, `Edge TTL vs Browser TTL`, and `ETag` individually. This section explains how they work *together*, and why the Edge Proxy is obligated to respect them rather than caching everything however it likes.

### The problem: how long is cached content still "correct"?

A cached copy is a bet that the underlying content hasn't changed. Left unchecked, that bet eventually goes bad — a customer updates their homepage, but visitors keep seeing the old cached version. `Cache-Control` and `TTL` exist to put a *time limit* on that bet, and the origin server (not just RivoCloud) gets a say in what that limit should be. Per the EDD, the proxy applies a priority order when several sources disagree about how long to cache something:

```
Priority 1: Zone cache rule match       (an operator explicitly configured this path, e.g. /api/* → TTL 0)
Priority 2: Origin Cache-Control: max-age=N   (the origin server's own stated freshness window)
Priority 3: Origin Expires: header      (an older, legacy way of saying the same thing)
Priority 4: Zone default TTL             (a fallback configured per zone)
Priority 5: Content-type based default   (images: 7 days, HTML: 5 minutes, everything else: 1 hour)
```

A few `Cache-Control` values change the proxy's behavior entirely rather than just setting a number: `no-store` from the origin means never cache this at all; `private` means the same; `no-cache` means "you may cache it, but you must re-check with the origin before serving it again" (see conditional requests, next). RivoCloud also *constructs* the `Cache-Control` header it sends back to the visitor's browser itself — it isn't simply forwarded unchanged from the origin — which is exactly what makes **Edge TTL** and **Browser TTL** independent of each other: the Edge Proxy might hold something in its own cache for 7 days while telling visitors' browsers to only trust their local copy for 1 hour.

### The problem: how do you "re-check" without re-downloading everything?

Once a cached copy's TTL expires, naively the proxy would have to re-fetch the *entire* object from origin again to see if it changed — wasteful if a 5MB JavaScript bundle is byte-for-byte identical to what's already cached. **ETag** and **conditional requests** solve this:

```
First request:
  Edge → Origin: GET /page.html
  Origin → Edge: 200, ETag: "abc123", Cache-Control: max-age=3600
  Edge caches the body along with its ETag "abc123"

After the TTL expires, the *next* request:
  Edge → Origin: GET /page.html, If-None-Match: "abc123"
  Origin → Edge: 304 Not Modified   (no body at all!)
  Edge: keeps the existing cached body, just refreshes its TTL
```

An **ETag** is a short fingerprint (often a hash) of a piece of content. The `If-None-Match` header is how the proxy asks the origin, in effect, "I already have the copy with fingerprint `abc123` — has it changed?" If the origin's current content still hashes to `abc123`, it replies `304 Not Modified` with *no body at all*, and the proxy just extends how long it trusts its existing cached copy. If the content actually changed, the origin replies normally with `200` and the new body plus a new ETag, and the proxy replaces its cached entry. This is why the EDD calls this "critical for bandwidth efficiency" — re-validating an unchanged 5MB bundle costs zero bytes of actual content transfer between the origin and the edge.

### Why the proxy is *obligated* to honor these, not just free to cache everything

If the proxy ignored `Cache-Control: no-store`/`private` and cached those responses anyway, it could leak content the origin explicitly marked as not cacheable (e.g., a response containing something user-specific). If it ignored ETags and always re-fetched full bodies, it would waste bandwidth and add latency for no reason. These headers are the *origin's* way of communicating caching rules to any well-behaved cache sitting in front of it, and the Edge Proxy has to respect that contract to behave correctly as a CDN rather than just a naive "store everything forever" proxy. (Two related behaviors worth knowing exist, even though they're not fully detailed here: `stale-while-revalidate` lets the proxy serve a slightly-stale response *while* it fetches a fresh one in the background, and `stale-if-error` lets it keep serving an expired cached copy if the origin is currently returning errors — RivoCloud adds a default 24-hour `stale-if-error` window so a temporary origin outage doesn't immediately turn into visible errors for every visitor.)

---

## 6. The build sequence: why 3.1 before 3.2 before 3.3?

Stage 3 is explicitly broken into three ordered sub-steps in the EDD's [development order](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md). This isn't an arbitrary checklist — each step is the *smallest possible* addition that can be independently validated before the next, riskier layer gets added on top.

| Step | What gets built | Why it comes at this point |
|---|---|---|
| **3.1 — HTTP server, bare forwarding** | A Go HTTP server that resolves a request to a (hardcoded, for now) zone config and forwards it to the origin, relaying the response back untouched. No caching at all. | Proves the most basic thing works first: can a Go program correctly receive an HTTP request and correctly proxy it to another server? Getting *this* right, with no caching layer complicating the picture, means any later bug is a caching bug, not a "the HTTP plumbing itself is broken" bug. |
| **3.2 — Redis cache layer (L2)** | The proxy starts checking Redis before forwarding to origin, and stores responses in Redis after fetching them. | Caching is the actual point of a CDN, so this validates the *core value proposition* early: does "second request comes back from Redis, marked `X-RivoCloud-Cache: HIT`" actually work end-to-end? This is deliberately done *before* the in-process LRU, so there's exactly one new moving part to debug at a time (Redis), rather than two at once. |
| **3.3 — In-process LRU (L1)** | The proxy adds its own in-memory cache in front of the now-working Redis layer. | Only added once L2 is proven correct — L1 is "just" a faster mirror of what L2 already does, so it can be layered on top of a mechanism that's already known to work, completing the full 3-layer hierarchy. |

The underlying engineering principle — "build the simplest possible thing first, validate it works, then add complexity incrementally" — is the same one the EDD calls out for the *whole* build order, not just this stage: at every step, whatever gets built first is a prerequisite that a later step needs, and building things in the wrong order means building parts of the system "blind," with no working piece yet to test them against. Notice also that Stage 3 deliberately uses a *hardcoded* zone config rather than waiting for the CDN Service (Stage 4, which manages real zone configuration in the database and publishes it to Redis) — this is the same pattern one level up: prove the Edge Proxy's caching mechanism works against a fake, hardcoded zone first, then let Stage 4 replace that hardcoded config with the real thing.

**What this basic build deliberately does *not* include yet:** the fuller Edge Proxy described in [EDD Section 2.1](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) also handles Range requests (for video seeking), response compression (gzip/brotli), and signed URL verification — but those aren't part of Stage 3's three sub-steps. They arrive incrementally in later stages (Signed URLs is its own Stage 10, for example), once this foundational 3-layer caching mechanism is proven to work.

---

## 7. A concrete walkthrough: first request vs. second request

Putting Sections 3–5 together, here's what happens end-to-end for two back-to-back requests for the same image, once Stage 3 is fully built (3.1 + 3.2 + 3.3):

**First request — a full miss at every layer**

1. A visitor requests `https://zone123.cdn.rivocloud.dev/logo.png`.
2. The Edge Proxy resolves the request to a zone config (in Stage 3's basic form, this is hardcoded; later stages read it from Redis, published by the CDN Service).
3. It builds the cache key from the normalized zone, path, and query string (Section 4).
4. **L1 check:** miss — this replica has never seen this object.
5. **L2 check:** miss — no other replica in this PoP has cached it either.
6. **L3 / origin fetch:** the proxy makes a real HTTP request to the customer's origin server for `/logo.png`. The origin responds `200 OK` with the image bytes, an `ETag`, and a `Cache-Control` header (or none, in which case the zone's default TTL applies — Section 5).
7. The proxy stores the response in **L2 (Redis)** and **L1 (in-process)**, then returns it to the visitor with a header like `X-RivoCloud-Cache: MISS`.
8. Total latency: dominated by however long the round trip to the origin took — potentially tens or hundreds of milliseconds, depending on where the origin server physically is.

**Second request — an L1 hit, under a millisecond**

1. A different visitor (or the same one) requests the exact same `logo.png` a few seconds later, and happens to be routed to the *same* Edge Proxy replica that handled the first request.
2. The proxy builds the identical cache key.
3. **L1 check:** hit. The object is already sitting in this replica's own process memory.
4. The proxy returns it immediately, with `X-RivoCloud-Cache: HIT`, having never made a network call to Redis, MinIO, or the origin at all.
5. Total latency: well under 1 millisecond — this is the entire reason the 3-layer cache exists.

(If the second request instead landed on a *different* replica in the same PoP — one that hasn't served this file before — step 3 would be an L1 miss, but step "L2 check" would be a hit, since Redis is shared across replicas in a PoP. That request would still be much faster than the first one, just not quite as fast as an L1 hit.)

---

## 8. Quick reference: how the pieces connect

```
Visitor's browser
      │
      │  GET /logo.png
      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Edge Proxy (Go)                          │
│                                                               │
│  1. Resolve zone config  (hardcoded in Stage 3;              │
│     later: read from Redis, published by CDN Service)       │
│  2. Build cache key      (zone + method + host + path +     │
│                            normalized query string)           │
│  3. Check L1 (in-process LRU) ── HIT? ──▶ return, <1ms       │
│         │ MISS                                               │
│         ▼                                                     │
│  4. Check L2 (local Redis)     ── HIT? ──▶ return, <1ms,     │
│         │ MISS                              populate L1      │
│         ▼                                                     │
│  5. Check L3 (MinIO)           ── HIT? ──▶ return,           │
│         │ MISS (or origin-pull zone)         populate L1+L2  │
│         ▼                                                     │
│  6. Forward to customer's origin server                      │
│         │                                                     │
│         ▼                                                     │
│  7. Apply Cache-Control / TTL rules, store ETag,             │
│     populate L1 + L2, return to visitor                     │
└─────────────────────────────────────────────────────────────┘

  L1 (in-process, ~0.1ms, small, per-replica)
      ↓ shared by all replicas in a PoP
  L2 (Redis, <1ms, larger, shared)
      ↓ shared infrastructure
  L3 (MinIO / origin, 20–50ms+, effectively unlimited)
```

**The one-line summary:** the Edge Proxy is a Go reverse proxy — Go for its low-latency, high-concurrency runtime — that checks three caches from fastest-but-smallest to slowest-but-biggest (in-process LRU → Redis → MinIO/origin) before ever bothering the customer's real server, using a carefully-normalized cache key and the origin's own `Cache-Control`/`ETag` headers to know what's safe to cache and for how long; and Stage 3 builds that mechanism in the smallest possible increments — bare forwarding, then Redis, then the in-process LRU — precisely so each layer can be proven correct before the next one is added on top.
