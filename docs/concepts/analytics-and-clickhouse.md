# Analytics & ClickHouse — Explained for Beginners

This document explains **Stage 9 (Analytics)** of RivoCloud's Phase 1 build order — the pipeline that turns raw, individual visitor requests into the bandwidth graphs, cache-hit-ratio charts, and latency numbers a customer sees on their dashboard. **Stage 9 has not been built yet.** Nothing described here exists in the codebase today — this is a concept guide for *what will be built and why*, grounded in:

- [`superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.7 (Analytics requirements) and Section 7 (roadmap, where Analytics is stage 9 of 16, targeted for Month 5)
- [`superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 2.5 (Analytics Service design), Section 6.6 (ClickHouse table schemas), Section 7.7 (analytics API endpoints), and Section 11 block 9 (the exact build steps: 9.1–9.4)
- [`superpowers/specs/2026-06-29-revocloud-master-architecture.md`](../superpowers/specs/2026-06-29-revocloud-master-architecture.md) — Section 5.7 (why ClickHouse was chosen over Elasticsearch/TimescaleDB)

If you haven't read them yet, start with [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) (especially its ClickHouse glossary entry and Walkthrough A, step 10) and [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) (which shows ClickHouse's container config, but doesn't explain the analytics pipeline itself — that's what this document does).

---

## 1. The problem: Postgres is bad at "count everything, fast"

RivoCloud already has PostgreSQL as its "source of truth" database — it stores users, organizations, zones, buckets. So why not just add a `request_logs` table to Postgres and store every visitor request there too?

Because of *volume* and *query shape*. A busy CDN zone can serve **thousands of requests per second**. Over a day, that's tens of millions of rows; over 90 days (the retention window this project plans — see Section 4 below), billions. And the questions the dashboard needs to answer aren't "find me the one row where `id = 42`" (what Postgres is built for) — they're things like:

- "Sum `bytes_sent` across 200 million rows from the last 7 days, grouped by hour."
- "What fraction of 50 million requests last month had `cache_status = HIT`?"
- "What's the 95th-percentile `duration_ms` across every request to zone X yesterday?"

Postgres *can* technically run these queries, but it will get slower and slower as the table grows, because of how it physically stores data. That's the problem ClickHouse exists to solve.

---

## 2. What makes ClickHouse different: "columnar" storage

**Postgres is a "row store."** Imagine a spreadsheet of requests, one row per request, one column per field (`timestamp`, `zone_id`, `bytes_sent`, `country`, ...). Postgres physically stores each **row** together on disk — all of one request's fields sit right next to each other. This is great when you want a *whole record* at once (e.g., "show me everything about this one order"), because it's one disk read. But it's wasteful when you only care about *one column* across *millions of rows* — to sum `bytes_sent` for a week, the database still has to read every other field of every row along the way, because they're all interleaved together.

**ClickHouse is a "columnar" (column-oriented) store.** It flips this around: instead of storing data row-by-row, it stores it **column-by-column** — all the `bytes_sent` values sit together in one contiguous block on disk, all the `country` values in another, and so on. Now, "sum `bytes_sent` across a billion rows" means reading *one* tight, contiguous block of just that column — not touching `path`, `client_ip_hash`, or any other field at all. Fewer bytes read from disk, and the values that *are* read are similar to each other (lots of repeated country codes, status codes, etc.), which compresses extremely well — ClickHouse routinely achieves ~10:1 compression on this kind of data (per the master architecture's comparison table). The tradeoff is the opposite of Postgres's strength: fetching one *entire* record back (all its columns) is relatively more work in a columnar store — but analytics dashboards almost never need that; they need sums, counts, and percentiles over specific columns, which is exactly what columnar storage is built for.

### Why not Elasticsearch or TimescaleDB instead?

The master architecture (Section 5.7) compared three real options before settling on ClickHouse:

| | ClickHouse | Elasticsearch | TimescaleDB |
|---|---|---|---|
| Query type | OLAP (aggregations, scans) | Full-text search + analytics | Time-series SQL |
| Ingestion throughput | Very high | High | Medium |
| Storage compression | Excellent (10:1 ratio) | Medium | Good |
| Query speed (aggregations) | Exceptional | Good | Good |
| Memory requirements | Low–medium | High | Medium |
| Operational complexity | Medium | High | Low |
| Used by CDNs | Cloudflare, ClickHouse.com | Yes | Less common for CDN |

**Decision: ClickHouse.** Cloudflare — a real, giant CDN — processes 10 trillion requests a day through it. Elasticsearch is optimized for *full-text search* (finding documents that contain a word), which isn't what "sum bytes sent by country" needs, and it's more memory-hungry to operate. TimescaleDB is a solid, simpler option (it's just a Postgres extension, so it reuses ops knowledge RivoCloud already has), but it isn't purpose-built for this exact workload the way ClickHouse is. A single ClickHouse instance is expected to comfortably handle billions of rows in Phase 1 before any horizontal scaling is needed.

> **Analogy carried over from the glossary:** think of Postgres as a filing cabinet organized by *folder* (one folder per request, containing every field about it) — great for pulling one folder out. ClickHouse is the same cabinet reorganized by *field* — one drawer for every timestamp ever recorded, one drawer for every byte-count ever recorded — great for "add up everything in this one drawer," useless for "give me folder #4,213,009 in its entirety."

---

## 3. The event pipeline: from one visitor's click to a row in ClickHouse

Per EDD Section 2.5 and Section 11 block 9 (steps 9.1–9.2), analytics data flows through three hops, not straight into the database:

```
Edge Proxy (Go)                Analytics Service (NestJS)         ClickHouse
     │                                    │                            │
     │  1. every request (hit or miss)   │                            │
     │     produces a small JSON event   │                            │
     ├──publish "edge.request"──▶ NATS ──┤                            │
     │                                    │  2. subscribes to          │
     │                                    │     "edge.request"        │
     │                                    │  3. buffers events in     │
     │                                    │     memory                │
     │                                    │  4. flushes the buffer    │
     │                                    │     as ONE bulk insert    │
     │                                    │     when it hits          │
     │                                    │     1,000 events, OR      │
     │                                    │     5 seconds elapse      │
     │                                    │     — whichever first     │
     │                                    ├────bulk INSERT──────────▶ │
```

### 3.1 The event itself

Every single request the Edge Proxy handles — hit or miss — produces one small event, published to NATS on the `edge.request` topic (per EDD Section 2.5):

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

Notice `client_ip_hash` rather than the raw IP address — the visitor's actual IP is hashed with SHA-256 before it ever reaches analytics storage, so RivoCloud can still deduplicate/analyze traffic patterns without permanently storing anyone's real IP address.

This is fired *asynchronously* — the Edge Proxy doesn't wait for NATS or ClickHouse to confirm anything before returning the response to the visitor. Publishing to NATS is fire-and-forget from the hot path's perspective, the same principle used for cache-invalidation events (see [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md), Walkthrough A step 10).

### 3.2 Why batch instead of inserting one row per request?

It would be *simpler* to have the Analytics Service run one `INSERT` per event, the moment it arrives. It's also the wrong design, for a reason that applies to almost every database, but especially to ClickHouse:

- **Every `INSERT` has fixed overhead** — network round-trip, transaction bookkeeping, and (for ClickHouse specifically) creating a new on-disk "part" of data that later has to be merged with others in the background. If a zone gets 2,000 requests/second, that's 2,000 tiny inserts/second, each paying that overhead separately — the database spends more effort managing overhead than storing actual data, and ClickHouse in particular is known to degrade badly under very frequent, very small inserts.
- **One bulk insert of 1,000 rows pays that overhead once.** The Analytics Service holds incoming events in memory and flushes them together — either once it has collected **1,000 events**, or every **5 seconds**, whichever happens first (this cap ensures a quiet zone with little traffic still gets its data written promptly, instead of waiting indefinitely to reach 1,000). This is the same "batch, don't trickle" idea behind why the Storage Service uses multipart uploads for large files, or why the CDN Service pushes zone config to Redis instead of the Edge Proxy querying Postgres per-request — batch what's expensive, keep the hot path unblocked.

The Analytics Service is stateless on the ingestion side and scales horizontally — since NATS distributes events across however many subscriber instances are running, adding more Analytics Service instances just means more parallel batching workers, not a bigger bottleneck.

---

## 4. What actually lands in ClickHouse: raw log + rollups

EDD Section 6.6 defines three ClickHouse tables. Understanding *why there are three, not one*, is the key idea in this section.

### 4.1 The raw table: `request_logs`

```sql
CREATE TABLE request_logs (
  timestamp       DateTime64(3, 'UTC'),
  zone_id         String,
  org_id          String,
  datacenter      String,
  method          LowCardinality(String),
  path            String,
  status_code     UInt16,
  cache_status    LowCardinality(String),
  bytes_sent      UInt64,
  duration_ms     UInt32,
  country         FixedString(2),
  client_ip_hash  String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (zone_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;
```

Every batch the Analytics Service flushes lands here, one row per original event — this is the full-fidelity, "nothing summarized yet" record.

- **`MergeTree`** is ClickHouse's standard storage engine — the one built for exactly this "insert a lot, query by scanning ranges" pattern.
- **`PARTITION BY toYYYYMM(timestamp)`** physically splits the table into one chunk per calendar month, so old data can be dropped a whole month at a time cheaply (relevant to the TTL below).
- **`ORDER BY (zone_id, timestamp)`** tells ClickHouse to physically sort data on disk by zone first, then time — matching how almost every analytics query filters ("this one zone, this time range"), so it can skip straight to the relevant range instead of scanning everything.
- **`TTL ... INTERVAL 90 DAY`** automatically deletes rows older than 90 days. Raw, per-request logs are only kept for 90 days — after that, only the pre-computed rollups (below) remain, which is fine because nobody needs to see individual request #4 million from six months ago; they need the *trends*.
- **`LowCardinality(String)`** is a ClickHouse-specific optimization for columns with few distinct values (like `method`: almost always `GET` or `HEAD`, or `cache_status`: `HIT`/`MISS`/`STALE`/`BYPASS`/`EXPIRED`) — it stores each distinct value once and refers to it by a small number internally, saving space and speeding up filtering.

### 4.2 The rollup tables: pre-computed answers

```sql
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

An **hourly rollup** is exactly what it sounds like: instead of "one row per request," it's "one row per zone, per hour, with the totals already added up" (total bytes sent that hour, total requests, how many were cache hits vs. misses). `SummingMergeTree` is a ClickHouse engine specifically designed for this — when rows with the same key (here, the same `zone_id` + `hour`) get merged in the background, their numeric columns are automatically *summed together*, so the table naturally stays as "one row per zone per hour" even though it might receive many partial updates.

**Why bother pre-computing this at all, instead of just summing `request_logs` on the fly every time?** Because "sum a column, grouped by hour, across 90 days of raw requests" is real computational work — for a busy zone, that might mean scanning tens of millions of raw rows every single time someone opens the dashboard's bandwidth chart. If ten customers open their dashboards at the same time, that's ten expensive scans happening simultaneously. Pre-computing the rollup once, ahead of time, means the dashboard's chart query becomes "read a few hundred already-summed rows" — dramatically faster and cheaper, no matter how many people are looking at it or how much raw data has piled up underneath. Per EDD Section 2.5's scaling strategy: *"Pre-compute rollups via Scheduler to reduce query cost on dashboard load."* The **Scheduler** microservice (introduced in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) Section 3.6 as the service that "runs recurring background jobs") is what runs this hourly rollup computation on a timer, per EDD Section 10's Month 5 task list.

This mirrors a pattern already used elsewhere in RivoCloud: the CDN Service doesn't make the Edge Proxy query Postgres on every request (too slow) — it pre-publishes config to Redis. Analytics applies the same "do the expensive work once, ahead of time, off the hot path" idea to dashboard queries.

---

## 5. What the dashboard actually shows

Per EDD Section 2.5 ("Analytics queries served") and Section 7.7 (the API), the Analytics Service exposes these endpoints, all under `/api/v1/analytics/`:

| Endpoint | What it answers |
|---|---|
| `GET /analytics/overview` | Org-wide summary: total bandwidth, total requests, overall hit ratio |
| `GET /analytics/bandwidth` | Bandwidth over time (bytes served, as a time series) |
| `GET /analytics/requests` | Request count over time |
| `GET /analytics/cache` | Cache hit ratio and a breakdown by `cache_status` (HIT/MISS/STALE/BYPASS/EXPIRED) |
| `GET /analytics/geography` | Requests by country, top 20 |
| `GET /analytics/latency` | P50/P95/P99 response latency over time |
| `GET /analytics/status-codes` | HTTP status code distribution |
| `GET /analytics/top-paths` | Top 50 most-requested URL paths |

All of them accept `?zoneId=` (default: every zone in the org), `?from=`/`?to=` (default: last 24 hours), and `?granularity=hour|day|week`. There's also an internal-only endpoint, `POST /internal/analytics/events`, alongside the NATS subscription path, for batch-ingesting raw events (EDD Section 7.9) — not something a customer ever calls directly.

### Explaining "P95 latency" for a beginner

`duration_ms` is recorded for every single request. Averaging all of them together is misleading — a handful of extremely slow outlier requests (say, a rare origin timeout) can drag the average up even though *almost everyone* had a fast experience, and a few very fast cache hits can drag it down even though some real users are being underserved.

**P95 latency** ("95th percentile") answers a more useful question: *"If I sort every request's response time from fastest to slowest, what's the time at the point where 95% of requests were faster than this, and only the slowest 5% were slower?"* It's a way to describe the "typical worst case" a real visitor might experience, without being thrown off by the rare, extreme outlier that an average would over-weight. P50 (median — half of requests were faster) and P99 (only the slowest 1% were slower — closer to true worst-case) round out the same idea at different strictness levels. Per EDD Section 10's Month 5 task list, the dashboard specifically surfaces a **P95 latency time series**, alongside a bandwidth area chart, a cache-hit-ratio gauge, a requests-by-country view, and a status-code pie chart.

---

## 6. A concrete walkthrough

1. A website visitor in France requests `https://{zone}.cdn.rivocloud.dev/logo.png`. DNS routes it to the nearest **Edge Proxy** (see [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) Section 3.3), which serves it from its 3-layer cache (an L1 hit, say) in under a millisecond.
2. As part of handling that request — *without* slowing down the response to the visitor — the Edge Proxy builds a small JSON event (`zone_id`, `country: "FR"`, `cache_status: "HIT"`, `bytes_sent`, `duration_ms`, etc.) and publishes it to NATS on the `edge.request` topic.
3. The **Analytics Service** (a NestJS microservice, always subscribed to `edge.request`) receives the event and adds it to an in-memory buffer. It doesn't write to ClickHouse yet — it's waiting for either 1,000 buffered events or 5 seconds to pass.
4. A moment later, that condition is met (this happens continuously, in parallel, for every zone across the whole platform), and the Analytics Service bulk-inserts the whole buffered batch into ClickHouse's `request_logs` table in one `INSERT`.
5. Separately, on its own schedule, the **Scheduler** service runs an hourly job that reads the last hour's worth of `request_logs` for every zone and writes the summed totals into `bandwidth_hourly` (and the country breakdown into `requests_by_country_daily`).
6. Later, the zone's owner opens the **Dashboard** and lands on the Analytics page. The dashboard's frontend calls `GET /api/v1/analytics/bandwidth?zoneId=zone_abc123&from=...&to=...&granularity=hour`.
7. The Analytics Service serves that query straight from the pre-computed `bandwidth_hourly` table — a handful of rows, not a scan of millions — and returns a time series.
8. The dashboard renders it as an area chart (via Recharts, per EDD Section 10's Month 5 plan), alongside a cache-hit-ratio gauge, a requests-by-country table/map, a P95 latency line, and a status-code pie chart — all backed by the same underlying pipeline.

---

## 7. Why Analytics depends on the Edge Proxy and the Dashboard

Per the PRD's roadmap table (Section 7) and the EDD's Section 11 dependency notes, Stage 9 (Analytics) depends on **Stage 3 (Edge Proxy)** and **Stage 6 (Dashboard)** — not on Stage 4 (CDN Service) or Stage 5 (Storage Service) directly:

- **It needs the Edge Proxy (Stage 3) to already exist and be handling real traffic.** Analytics has nothing to measure until there's a running proxy generating `edge.request` events for actual hits and misses. Building an analytics pipeline before there's traffic to analyze would mean testing against fabricated data with no way to validate the pipeline actually reflects reality.
- **It needs the Dashboard (Stage 6) to already exist as a place to render charts into.** The Analytics Service can expose `/analytics/bandwidth` as an API, but that API is only useful to a human once there's a dashboard page and chart components (built in Stage 6) ready to call it and draw something with the response.

This is the same "foundation → mechanism → management → polish" sequencing described in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#the-key-idea-behind-the-ordering): you can't build the *measurement* layer before the thing being measured (the Edge Proxy) and the *display* layer for what's measured (the Dashboard) both already exist.

---

## 8. Where this fits in the 16-stage build order

```
Stage 3: Edge Proxy ──(generates real traffic)──┐
                                                  ├──▶ Stage 9: Analytics ──▶ Stage 12: Billing
Stage 6: Dashboard ───(place to show charts)────┘         (usage-based plan limits
                                                             read from Analytics data)
```

Per the PRD's risk table (Section 8) and roadmap (Section 7), Analytics also feeds forward into **Stage 12 (Billing)** later in the build order — usage-based plan limits (e.g., disabling a free-tier zone once it exceeds its bandwidth cap) are metered from analytics data, per PRD Section 5.9. That's a later concern; this document covers only what Stage 9 itself builds.

For the full 16-stage list and how every other stage connects, see [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages) Section 5, and the roadmap table in [`superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) Section 7.

---

**The one-line summary:** Postgres is built to fetch whole records fast; ClickHouse is built to crunch one column across billions of records fast — so every request the Edge Proxy handles becomes a tiny NATS event, the Analytics Service batches thousands of them into single bulk inserts instead of one-row-at-a-time writes, the Scheduler pre-computes hourly rollups so dashboard charts never have to re-scan raw history, and the Dashboard turns all of it into the bandwidth, cache-hit-ratio, geography, and P95-latency charts a customer actually looks at.
