# Object Storage & Uploads — Explained for Beginners

This document explains **the concepts behind RivoCloud's Storage Service** — the Stage 5 build in the [16-stage Phase 1 roadmap](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap). Stage 5 has **not been built yet** — this is preparation reading, grounded entirely in the [PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) (Section 5.4) and the [Engineering Design Document](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Sections 2.4, 4, 6.3, 7.6, 11), not on any existing code.

If you haven't read them yet:
- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) introduces Object Storage, Buckets, Presigned URLs, and Multipart Upload at a glossary level (Section 3.2), plus a short Walkthrough B of the upload flow. This document goes much deeper on the same territory.
- [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) explains **how MinIO is started locally** (the container, its port mappings, its volume) but deliberately says little about what happens *inside* it. This document is the other half of that story.

---

## 1. Why object storage isn't a filesystem

If you've ever saved a file on your own computer, you're used to a **filesystem**: a tree of folders and subfolders, each file living at some nested path like `C:\Users\me\Documents\photos\summer\beach.jpg`. Filesystems support things like renaming a folder (which instantly "moves" everything inside it), partial in-place edits, and file locking.

**Object storage** throws most of that away, deliberately, in exchange for something that scales to billions of files across many machines. Instead of a folder tree, object storage is a flat system with exactly two kinds of things:

- A **bucket** — a named container. Think of it as a top-level namespace, not a folder you can nest other folders inside.
- An **object** — a file, identified by a **key** (a string like `assets/hero.jpg`) inside a bucket. The slashes in a key *look* like folder separators and most tools (including MinIO's own web console) display them as if they were folders, but structurally there is no folder — `assets/hero.jpg` and `assets/thumbnails/hero-sm.jpg` are just two unrelated objects whose keys happen to share a text prefix.

Why give up the familiar folder model? Because a flat key → object mapping is trivial to shard across hundreds of physical drives and machines: given a key, a hashing scheme decides which drive holds it, with no need to walk a directory tree or coordinate folder metadata. This is exactly the design Amazon popularized with **S3** (Simple Storage Service), and it's now a *de facto standard API* that many storage systems implement — including **MinIO**, the open-source, self-hosted engine RivoCloud runs instead of paying Amazon (see the "MinIO" glossary entry and Section 4 of [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md#4-the-rivocloud-stack-service-by-service)). Any tool built against "the S3 API" — SDKs, CLI utilities, this document's concepts — works unmodified against MinIO. That's what "S3-compatible" means.

**Concretely, for RivoCloud:** every organization creates one or more buckets (`buckets` table, [EDD §6.3](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#63-storage-tables)), and every file an organization stores becomes a row in the `objects` table plus the actual bytes sitting in MinIO under a `storage_path` like `{bucket_id}/{key}/{version_id}`. Two databases of truth, one for metadata (Postgres) and one for bytes (MinIO) — more on why in Section 3.

---

## 2. Why uploads don't go through RivoCloud's own API servers

Here's the naive way to design a file upload: the client sends the file's bytes in an HTTP request body straight to RivoCloud's own API server (the Storage Service), which then turns around and writes those bytes into MinIO.

This works for small files and low traffic, but it doesn't scale, for a very concrete reason: **the Storage Service's job is to manage metadata — tiny JSON records — not to shovel gigabytes of file bytes around.** If every upload's bytes had to physically pass through the Storage Service:

- Every NestJS process handling uploads would spend most of its CPU and memory buffering large request bodies, instead of doing the lightweight database work it's actually good at.
- The Storage Service would need as much *network bandwidth* as every customer's total upload traffic combined — turning a cheap, stateless service into a bandwidth bottleneck that has to scale with storage traffic, not with API-call volume.
- A slow or flaky client uploading a 2GB video would tie up a Storage Service connection/worker for the entire transfer.

RivoCloud avoids all of this with a **presigned URL**: a temporary, cryptographically-signed URL that grants permission to upload (or download) one specific object, directly to/from MinIO, without MinIO needing to check back with anyone. The Storage Service's role shrinks to just *handing out* that URL — a fast, CPU-light operation — after which the heavy lifting (the actual bytes) flows client → MinIO directly, on a completely separate network path that never touches the Storage Service's process at all.

This is the same "control plane vs. data plane" split introduced in [Section 2 of the beginners' doc](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds), just applied one layer down: **generating** an upload URL is control-plane work (must be correct, authorized, and can be a little slow); **transferring** the file bytes is data-plane work (must be fast, and doesn't need RivoCloud's business logic in the middle at all).

Per the EDD, MinIO's presigned PUT URLs are generated with a **15-minute expiry** (`MinIO.PresignedPutObject(bucket, key, TTL=15min)`, [EDD §4.2](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#42-upload-flow-origin-push)) — long enough for a normal upload, short enough that a leaked URL stops being useful quickly.

### Multipart upload: the same idea, for very large files

A single presigned PUT is fine for a typical file, but very large files (think multi-gigabyte video) create a different problem: if the upload drops at 95% complete, restarting from zero wastes most of the transfer. **Multipart upload** solves this by splitting one big file into numbered chunks ("parts"), each with its own presigned URL, uploaded independently (and potentially in parallel); only the last failed part needs retrying. MinIO tracks the in-progress parts server-side under an upload ID until the client tells it "all parts are in, assemble the final object" (`complete`) — or the whole thing is abandoned (`abort`). RivoCloud's schema reflects this directly with a `multipart_uploads` table holding the MinIO upload ID, the uploaded parts' ETags as JSON, and an `expires_at` for auto-aborting abandoned attempts ([EDD §6.3](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#63-storage-tables)), and dedicated endpoints (`/multipart/init`, `/multipart/:id/part`, `/multipart/:id/complete`, `DELETE /multipart/:id` — [EDD §7.6](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#76-storage-endpoints)).

---

## 3. The full upload lifecycle

Putting the presigned-URL idea into a concrete sequence, here is the upload flow the Storage Service is specified to implement ([EDD §2.4](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#24-storage-service-nestjs) and [§4.2](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#42-upload-flow-origin-push)):

```
 Client                Storage Service            PostgreSQL         MinIO            NATS
   │                         │                         │                │                │
   │ POST /buckets/:id/      │                         │                │                │
   │ objects/upload          │                         │                │                │
   │ {key, contentType,size} │                         │                │                │
   ├────────────────────────▶│                         │                │                │
   │                         │ validate auth + bucket  │                │                │
   │                         │ permissions (Identity)  │                │                │
   │                         │                         │                │                │
   │                         │ INSERT objects           │                │                │
   │                         │ (status = 'pending')     │                │                │
   │                         ├────────────────────────▶│                │                │
   │                         │                         │                │                │
   │                         │ MinIO.PresignedPutObject(bucket, key, 15min)               │
   │                         ├──────────────────────────────────────────▶│                │
   │                         │◀──────────────────────────────────────────┤                │
   │  { uploadUrl, objectId }│                         │                │                │
   │◀────────────────────────┤                         │                │                │
   │                         │                         │                │                │
   │ PUT <uploadUrl>  (direct, bypasses Storage Service)                 │                │
   ├───────────────────────────────────────────────────────────────────▶│                │
   │◀ 200 OK (object stored) ───────────────────────────────────────────┤                │
   │                         │                         │                │                │
   │                         │        MinIO fires webhook: s3:ObjectCreated:Put            │
   │                         │◀──────────────────────────────────────────┤                │
   │                         │                         │                │                │
   │                         │ UPDATE objects SET       │                │                │
   │                         │ status='ready', etag,    │                │                │
   │                         │ size                     │                │                │
   │                         ├────────────────────────▶│                │                │
   │                         │                         │                │                │
   │                         │ publish "object.uploaded" {bucket_id, key, org_id}          │
   │                         ├───────────────────────────────────────────────────────────▶│
```

Walking through it in words:

1. **Client requests a presigned URL.** It calls `POST /api/v1/buckets/:bucketId/objects/upload` on the Storage Service with the intended key, content type, and size — no file bytes yet.
2. **Storage Service validates and records intent.** It checks the caller is authenticated and authorized for this bucket (via the Identity Service — see Section 6), then inserts a row into the `objects` table with `status: 'pending'`. This row exists *before* any bytes have moved — it's a placeholder saying "an upload is expected here."
3. **Storage Service asks MinIO for a presigned URL** and returns it to the client along with the new `objectId`. Generating this URL is pure cryptography (an HMAC-style signature over the request parameters) — no data transfer happens yet, which is why this step is cheap and fast.
4. **Client uploads directly to MinIO**, `PUT`-ing the file bytes straight at the presigned URL. The Storage Service is completely out of this step — it isn't a proxy, doesn't see the bytes, and doesn't need to stay connected while the transfer happens.
5. **MinIO fires a webhook (event notification)** back to the Storage Service once the object lands: `s3:ObjectCreated:Put`, carrying the bucket, key, size, and ETag.
6. **Storage Service updates the metadata row** from `pending` to `ready`, filling in the real `size` and `etag` MinIO reported (which may differ from what the client *claimed* in step 1 — this is the trustworthy, verified value).
7. **Storage Service publishes `object.uploaded` to NATS**, carrying `{bucket_id, key, org_id}`. This is the same publish/subscribe mechanism used for cache invalidation ([`phase1-explained-for-beginners.md` §3.3](../phase1-explained-for-beginners.md#33-core-infrastructure-pieces-the-ingredients)) — any other service that cares ("a new object exists") can subscribe without the Storage Service needing to know who's listening. One immediate consumer: an optional cache-warming step, where the CDN Service or a client can ask the edge proxy to pre-fetch the new object from MinIO into Redis, so the *first* real visitor doesn't pay the cache-miss cost ([EDD §4.2](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#42-upload-flow-origin-push), Step 8).

Until step 6 completes, the object is `pending` — if you queried it right after step 1, you'd see a row with no `size` or `etag` yet, which is the system's way of representing "upload in flight, not yet confirmed."

### Deletion follows a similar asynchronous shape

Per the EDD ([§2.4](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#24-storage-service-nestjs)), deleting an object is a **soft-delete**: the Storage Service marks the metadata row (`status: 'deleting'` then `'deleted'`) immediately, while the actual MinIO deletion happens asynchronously in the background. This means "delete" returns quickly to the caller without waiting on MinIO I/O, at the cost of a brief window where the metadata says deleted but the bytes haven't been physically removed yet.

---

## 4. Origin Push vs. Origin Pull — and why Storage Service is what makes Push possible

[`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#31-cdn-concepts) already introduces the two ways content gets into RivoCloud's CDN:

- **Origin Pull:** the CDN fetches from the customer's *own* existing server the first time content is requested, then caches the result. Nothing needs to be uploaded anywhere in advance — the customer's server remains the source of truth.
- **Origin Push:** the customer uploads files directly into RivoCloud's own storage (MinIO) ahead of time, and the CDN serves them straight from there — no external origin server is ever contacted.

Origin Pull only needs the Edge Proxy (Stage 3) and CDN Service (Stage 4) — see the [CDN / Zones functional requirement](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#52-cdn--zones-p0-month-2) — there's no "storage" involved from RivoCloud's side at all. **Origin Push is different: it has nothing to push *to* until the Storage Service exists.** That's precisely why Storage Service is Stage 5 in the [roadmap](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap) — it's the stage that gives customers somewhere durable to put files, with buckets and metadata tracked correctly, so that a "push zone" has real content to serve.

Concretely, per the [Download Flow in the EDD](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#43-download-flow-cdn-serving) (§4.3), when a zone is configured as `storage_type == "push"`, a cache miss at the edge proxy's L1/L2 layers falls through to **MinIO** (L3) rather than to a customer's origin server:

```
if zone.storage_type == "push":
    minio.GetObject(bucket, object_key) → cache in L2 + L1, return
else:
    // Pull zone: forward to customer's origin server (never MinIO)
    http.Get(zone.origin_url + path) → cache in L2 + L1, return
```

The EDD is explicit that this is a hard split, not a fallback chain: pull zones never touch MinIO, and push zones never contact an external origin. See [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md#4-the-rivocloud-stack-service-by-service) for how the `minio` container itself is provisioned locally, and the future `cdn-zones-and-configuration.md` concept doc (Stage 4, not yet written) for the full mechanics of zone configuration and the 3-layer cache.

---

## 5. Object versioning and lifecycle policies — schema now, features later

Both of these are easy to overstate, so it's worth being precise about exactly what Phase 1 does and doesn't build, straight from the EDD and PRD.

**Object versioning**, conceptually: instead of overwriting a file in place when it's re-uploaded, the system keeps the old copy around too, so you could restore a previous version if the new one turns out to be wrong. Every object in RivoCloud's schema has a `version_id` (a UUID) and an `is_latest` boolean; per the EDD's design ([§4.5](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#45-object-versioning)), updating an object means *inserting a new row* with a new `version_id` and `is_latest: true`, then flipping the previous row's `is_latest` to `false` — the old version's bytes stay in MinIO at `{bucket}/{key}/{old_version_id}` rather than being overwritten.

**Lifecycle policies**, conceptually: an automated cleanup rule, like "delete anything under the `tmp/` prefix after 30 days." The `buckets` table has a `lifecycle_rules JSONB` column designed to hold exactly that kind of rule (e.g. `[{ "id": "1", "prefix": "tmp/", "expireDays": 30 }]`).

**What Phase 1 actually delivers for both, per the EDD and PRD, is only the database shape** — the `version_id`/`is_latest` columns and the `lifecycle_rules` JSONB column exist so a later migration isn't needed, but:

- There is **no API or dashboard UI** in Phase 1 to list, restore, or manage old versions.
- There is **no Scheduler job** in Phase 1 that actually reads `lifecycle_rules` and deletes expired objects — the EDD explicitly lists "Lifecycle policy execution" as a Scheduler responsibility, but marks it deferred.

Both are called out explicitly as **Phase 2 scope** in the EDD's "What Phase 1 Explicitly Does Not Include" list and the PRD's non-goals: *"Object versioning API and UI (Phase 2 — schema is ready)"* and *"Lifecycle policy execution (Phase 2 — schema is ready)"* ([EDD §1](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#1-phase-1-scope-and-goals); [PRD §4](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#4-scope--non-goals)). So when Stage 5 is built, expect to see the `version_id`, `is_latest`, and `lifecycle_rules` columns land in the schema and get populated correctly on every write/delete — but do not expect a "restore version 3" button, or files actually vanishing automatically after their configured expiry, until Phase 2.

---

## 6. Why this depends on the Identity Service (Stage 2)

Storage Service is listed in the roadmap as depending on Stage 2 (Identity Service) and nothing else application-level ([PRD §7](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap); [EDD §11.5](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#11-development-order)). The reason is scoping: every bucket belongs to exactly one **organization** (`buckets.org_id`, [EDD §6.3](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#63-storage-tables)), and every upload or delete request has to be checked against *whose* organization it's acting on before it's allowed to proceed. Without an Identity Service already providing:

- a way to prove "this request is authenticated as user X" (JWT) or "this request is using API key Y" ([`phase1-explained-for-beginners.md` §3.4](../phase1-explained-for-beginners.md#34-identity-security-and-access)),
- and a way to resolve that identity to an organization and role,

...the Storage Service would have no way to answer the question "is this caller allowed to upload into *this specific* bucket?" — anyone could upload into or delete from anyone else's bucket, since buckets are otherwise just rows in a shared table. This is exactly the shared **Auth Guard** built at Stage 2.4 (see [EDD §11.2](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#11-development-order)) — every later service, including Storage Service, imports and reuses it rather than re-implementing auth checks from scratch. The build order table even spells this out directly for Stage 5.1 (Bucket CRUD): *"Depends: 2.4, Prisma schema (buckets), MinIO running."*

Fine-grained API-key scopes reinforce the same idea at a more granular level: an API key can carry `storage:read`, `storage:write`, or `storage:delete` permissions independently ([EDD §8.2](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md#82-authorization-rbac)) — so a script with only `storage:read` can list and download objects, but a call to the upload or delete endpoints will be rejected before the Storage Service does anything else.

---

## 7. Presigned URL vs. Signed URL — two similar-sounding, different things

The source specs use both terms, and it's easy to blur them together. They solve different problems, for different directions of traffic:

| | Presigned URL | Signed URL |
|---|---|---|
| Direction | **Upload** (and internal download) | **Download** of private content, publicly |
| Who generates it | Storage Service, by calling MinIO's own SDK (`MinIO.PresignedPutObject`) | Storage Service, by computing its own HMAC-SHA256 signature |
| Who verifies it | MinIO itself, using its S3-compatible signature scheme | The **Edge Proxy**, at request time, with zero calls back to the control plane |
| Typical TTL | 15 minutes | Configurable, often minutes to hours (e.g. "this download link works for 15 minutes") |
| Used for | Getting file bytes *into* (or out of) MinIO directly | Letting a CDN visitor fetch one specific private object through the CDN |

Put another way: a **presigned URL** is MinIO's own mechanism for saying "the bearer of this exact URL may `PUT`/`GET` this exact object, until it expires" — it's part of the S3-compatible API and only concerns getting bytes to/from MinIO. A **signed URL** is a RivoCloud-specific mechanism, built on the Storage Service's own signing secret, that the *Edge Proxy* checks when serving CDN traffic — it's what lets a customer share `https://cdn.customer.com/private/video.mp4?expires=...&sig=...` with someone for 15 minutes without that person needing any RivoCloud login at all. Signed URLs are Stage 10 in the roadmap (see the future `signed-urls-and-hmac.md` concept doc) and depend on the Storage Service already existing — but the underlying *object* being shared is exactly the kind this document covers.

---

## 8. Quick reference table

| Concept | What it is | Where it lives / who owns it |
|---|---|---|
| Bucket | Named container for objects, scoped to one organization | `buckets` table (Postgres) + a matching bucket on MinIO |
| Object | A file, identified by a key, inside a bucket | `objects` table (metadata) + bytes in MinIO at `storage_path` |
| Presigned URL | Temporary signed URL for direct client ↔ MinIO transfer | Generated by Storage Service via `MinIO.PresignedPutObject`, 15-min TTL |
| Multipart upload | Chunked upload for very large files, resumable per-part | `multipart_uploads` table + MinIO's native multipart API |
| `object.uploaded` event | Notifies other services an upload finished | Published to NATS by Storage Service after MinIO's webhook fires |
| Origin Push | CDN serves pre-uploaded RivoCloud-storage content, no external origin | Edge proxy L3 = MinIO, when `zone.storage_type == "push"` |
| Origin Pull | CDN fetches from the customer's own server on demand | Edge proxy forwards to `zone.origin_url`; MinIO never touched |
| Object versioning | Keep old copies on overwrite, restorable later | Phase 1: `version_id`/`is_latest` columns only. Restore UI/API: Phase 2 |
| Lifecycle policy | Rule to auto-expire objects after N days | Phase 1: `lifecycle_rules` JSONB column only. Execution: Phase 2 |
| Auth dependency | Every upload/delete scoped to the caller's organization | Reuses the Auth Guard built in Identity Service (Stage 2.4) |

---

## 9. Where this fits in the bigger picture

Storage Service (Stage 5) sits right after the CDN Service (Stage 4) in the roadmap and right before the Dashboard MVP (Stage 6), because the Dashboard's storage UI — a bucket list and file browser with an upload button — has nothing to call until this stage exists ([PRD §7](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap)). Downstream, **Signed URLs (Stage 10)** build directly on top of this stage's objects — a signed URL is just a time-limited, HMAC-verified download link for an object that already exists here — which is why Stage 10 lists Stage 5 as its dependency.

For the full 16-stage build order and how every stage connects, see [Section 5 of `phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages) and [Section 7 of the PRD](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md#7-implementation-roadmap).

**The one-line summary:** RivoCloud's Storage Service will manage buckets and object *metadata* only — the actual bytes flow directly between the client and MinIO via short-lived presigned URLs, with MinIO's own webhook telling the Storage Service when an upload is really done, so that Storage Service work stays cheap and stateless no matter how much data customers move through it.
