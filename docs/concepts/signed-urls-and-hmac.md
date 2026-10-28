# Signed URLs & HMAC — Explained for Beginners

This document explains **Stage 10 (Signed URLs)** of RivoCloud's Phase 1 build: what problem signed URLs solve, what HMAC is and why it's the right tool for the job, and how a signed URL is generated and checked. Stage 10 is built. Sections 1–7 explain the concepts as the design documents describe them, and [Section 8](#8-what-was-actually-built) records where the implementation made its own choices. The sources are:

- [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) — see the "Signed URL" glossary entry in Section 3.1, and Stage 10 in the [16-stage build order](../phase1-explained-for-beginners.md#5-how-phase-1-is-built-the-16-stages). This document goes deeper than that glossary entry.
- [`superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.6 (the product requirement) and Section 7 (the authoritative stage roadmap).
- [`superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 5.5 (the signature scheme in detail) and Section 11's "10. SIGNED URLS" block (the two build steps).
- [`superpowers/plans/2026-09-26-phase1-stage10-signed-urls.md`](../superpowers/plans/2026-09-26-phase1-stage10-signed-urls.md) — the implementation plan, including the design decisions summarized in Section 8.

If you haven't read [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md) yet, do that first — it explains the Control Plane / Data Plane split, the Storage Service, and the Edge Proxy, all of which this document assumes you already understand.

---

## 1. The problem: how do you share a private file, temporarily, without a login?

RivoCloud's object storage (built in Stage 5) lets a customer store **private** files — think an invoice PDF, a user-uploaded video, a paid download. "Private" means: not just anyone on the internet should be able to fetch it by guessing or finding the URL.

But often you still want to *hand that file to someone specific*, for a limited time, without asking them to create a RivoCloud account or log in. Some real examples:

- "Here's your invoice — this link works for the next 15 minutes, then it expires."
- "Download your exported report — the link is only valid for 1 hour."
- "Stream this video you purchased — but don't let people share the raw link forever."

There are three bad options for solving this:

1. **Make the file fully public.** Simple, but now *anyone* who ever discovers the URL — forwarded in an email, cached by a search engine, pasted somewhere — has permanent access. No expiration, no revocation.
2. **Require login for every download.** Secure, but now you can't share a link with someone who doesn't have (or shouldn't need) a RivoCloud account — e.g., a customer's own end-user who just wants to click a link in an email.
3. **Have the Storage Service check every download request.** This would work, but it means *every single file request*, from every visitor, has to make a network round-trip to the control plane to ask "is this still allowed?" before serving a byte. That's slow, and it puts control-plane load in the critical path of the Data Plane — exactly the kind of thing [Section 2 of the beginners doc](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds) says the Data Plane must avoid.

**Signed URLs** are the fourth option: a URL that carries its own proof of "this access was authorized, and only until this specific time" — baked directly into the URL's query string — so whoever is serving the file can verify it *by itself*, instantly, with no round-trip to anywhere.

---

## 2. HMAC in plain language: a seal only you can stamp

The mechanism that makes a signed URL trustworthy is called **HMAC** (Hash-based Message Authentication Code). Strip away the acronym and the idea is simple:

> Take a **message** (some text) and a **secret key** that only you know. Run them both through a one-way mathematical function. Out comes a short, fixed-length **signature**. Anyone who has the *same secret key* can redo that exact calculation and check whether a given signature matches a given message. Anyone who *doesn't* have the secret key cannot produce a valid signature for any message, no matter how hard they try — and they can't reverse-engineer the secret key from a signature either.

**The wax seal analogy:** imagine a medieval letter sealed with melted wax and stamped with a unique signet ring. Anyone can *look at* the seal and compare it to a known impression to check "is this really from the person who owns this ring?" But nobody without the actual ring can *produce* a matching seal — and having seen a hundred sealed letters doesn't help you forge the ring's design. HMAC is the digital version: the "ring" is the secret key, the "wax seal" is the signature, and "comparing seals" is the verification step.

Two properties fall out of this that matter enormously for signed URLs:

- **Tamper-evidence:** if you change even one character of the message (e.g., edit the path or the expiration time in the URL), recomputing the signature produces a *completely different* result. So a signature only matches the *exact* message it was created for — nobody can edit a signed URL to, say, extend its expiration time or point it at a different file, because the signature would no longer match.
- **Unforgeability:** without the secret key, there is no practical way to compute a valid signature for a new message. This is why the secret key must **never** leave RivoCloud's backend — it must not be embedded in a mobile app, a frontend JS bundle, or anywhere a user could extract it.

RivoCloud specifically uses **HMAC-SHA256** (EDD Section 5.5 / Section 11) — HMAC built on top of the SHA-256 hashing algorithm. "Which exact hash function is used" isn't something you need to reason about conceptually; what matters is that it's a well-established, cryptographically strong combination, not something RivoCloud is inventing from scratch.

| Term | Plain-language meaning |
|---|---|
| **Message** | The data being signed — for RivoCloud, the expiration timestamp plus the object's path, concatenated together. |
| **Secret key** | A value known only to RivoCloud's backend (the zone's signing secret) — never sent to a browser or embedded in client code. |
| **Signature (a.k.a. HMAC, "sig")** | The output of running the message and secret key through HMAC-SHA256 — a fixed-length string of hex characters. |
| **Verify** | Recompute the signature from the message using the same secret key, and check it matches the signature that was supplied. No database lookup of "is this token valid" needed — the math *is* the check. |

---

## 3. What actually goes into a signed URL

Per the EDD's signature scheme (Section 5.5), a signed URL is built from three ingredients:

1. **The resource path** — which object is being granted access to, e.g. `/private/video.mp4`.
2. **An expiration timestamp** (`expires`) — a Unix timestamp saying "this URL is no longer valid after this moment."
3. **A signature** (`sig`) — the HMAC-SHA256 output computed over the path and expiration, using a secret only RivoCloud's backend knows (the zone's signing secret).

Concretely (from the EDD):

```
expires_unix = unix_timestamp_when_url_expires
path         = "/private/video.mp4"
zone_secret  = "zone_signing_secret_from_config"

message   = expires_unix + ":" + path
signature = HMAC-SHA256(zone_secret, message)

signed_url = "https://cdn.customer.com/private/video.mp4?expires={expires_unix}&sig={hex(signature)}"
```

Notice what is — and isn't — secret here. The **path** and **expiration** are sent in plain sight, right in the URL, for anyone to read. Only the **secret key** used to compute the signature is hidden. That's the whole point of HMAC: the message doesn't need to be secret, only the key does, because knowing the message alone (without the key) is useless for producing a valid signature.

The EDD also describes optional modifiers that can ride along in the query string once the base scheme works:

- `&ip=203.0.113.0/24` — restrict the URL to a specific IP range, checked at the edge.
- `&download=1` — force the browser to download the file (`Content-Disposition: attachment`) instead of displaying it inline.
- `&filename=report.pdf` — set the filename the browser saves the download as.

---

## 4. Why the Edge Proxy has to verify this itself — not just the Storage Service

This is the detail that trips people up: signed URLs are *generated* by the Storage Service, but they are *verified* by the Edge Proxy — a completely different service. Why not have the Storage Service handle both?

Recall the Control Plane / Data Plane split from [Section 2 of the beginners doc](../phase1-explained-for-beginners.md#2-the-big-picture-two-worlds): the **Edge Proxy is the Data Plane** — it's the program that actually receives the visitor's HTTP request and serves the file bytes back. The Storage Service is Control Plane — it only gets involved when someone explicitly asks it to create or manage something. A visitor clicking a signed download link never talks to the Storage Service at all; they talk directly to the Edge Proxy (or the CDN in front of it).

That means the Edge Proxy is the *only* thing standing between "here's a URL" and "here are the file's bytes." If the Edge Proxy blindly served whatever object a URL pointed to, the signature and expiration in the query string would be decorative — nothing would actually stop an expired or tampered link from still working. So the Edge Proxy itself must:

1. Read `expires` and `sig` off the incoming request's query string.
2. Reject it (`403 Forbidden`) if `expires` is in the past.
3. Recompute the expected signature from the request path and `expires`, using the same zone signing secret.
4. Reject it (`403 Forbidden`) if the recomputed signature doesn't match the `sig` in the URL.
5. Only then serve the object.

This is exactly what the EDD's Go snippet (Section 5.5) does:

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

Crucially, none of this requires the Edge Proxy to call the Storage Service, or any other control-plane service, per request. It only needs one thing ahead of time: the zone's signing secret. Per the EDD, that secret is stored durably in PostgreSQL (encrypted at rest), and the Edge Proxy caches a copy in Redis with a **60-second TTL** — the same "cache configuration close to the Data Plane" pattern already used for zone config (see [`docker-compose-and-infrastructure.md`](docker-compose-and-infrastructure.md) and the CDN Service's Redis publication in Stage 4). If a secret is ever rotated, the CDN Service updates PostgreSQL and publishes a NATS event so every Edge Proxy flushes its cached copy — the same invalidation pattern used for cache purges (Stage 7). This keeps the "zero control-plane round-trips per request" property intact even when secrets change.

---

## 5. A concrete walkthrough

1. A customer's app calls the **Storage Service**: `POST /objects/:key/sign` (per EDD Section 11, step 10.1 — the actual documented path is `POST /buckets/:id/objects/:key/sign`, scoped to a bucket). This requires the app to already be authenticated (an API key or JWT) — signed-URL *generation* is a Control Plane action guarded like any other.
2. The Storage Service looks up the object, decides on an expiration (e.g., 15 minutes from now), computes `HMAC-SHA256(zone_secret, "expires:path")`, and returns a URL like:
   ```
   https://cdn.customer.com/private/video.mp4?expires=1753456789&sig=9f86d081884c7d659...
   ```
3. The customer's app shares that URL with a user however it likes — an email, a chat message, embedded in a web page. The URL itself is the only thing that needs to be shared; no additional login is required.
4. The user's browser makes a normal HTTP `GET` request for that URL. This request goes to the **Edge Proxy** (or the CDN in front of it) — not to the Storage Service. The Storage Service is not involved in this step at all.
5. The Edge Proxy (EDD Section 11, step 10.2) extracts `expires` and `sig` from the query string, checks the expiration hasn't passed, recomputes the expected signature using the same zone secret it has cached in Redis, and compares the two signatures.
6. **If they match and the URL hasn't expired:** the Edge Proxy serves the file, exactly as it would for a normal push-zone object (see the 3-layer cache described in [`phase1-explained-for-beginners.md`](../phase1-explained-for-beginners.md#33-core-infrastructure-pieces-the-ingredients)).
7. **If the signature doesn't match, or `expires` is in the past:** the Edge Proxy returns `403 Forbidden` — no file bytes are served, and no call back to the Storage Service was ever needed to make that decision.

```
Customer's app                Storage Service              Edge Proxy                 User's browser
      │                              │                          │                            │
      │ POST /objects/:key/sign      │                          │                            │
      ├─────────────────────────────▶│                          │                            │
      │                              │ compute HMAC-SHA256       │                            │
      │                              │ (path + expires, secret)  │                            │
      │◀─────────────────────────────┤                          │                            │
      │ signed URL (expires + sig)   │                          │                            │
      │                                                          │                            │
      │ share the URL with the user (email, chat, embed, etc.)                                │
      ├───────────────────────────────────────────────────────────────────────────────────────▶
      │                                                          │                            │
      │                                                          │◀───── GET signed URL ──────┤
      │                                                          │ recompute HMAC using        │
      │                                                          │ cached zone secret (Redis)  │
      │                                                          │ compare to `sig`, check     │
      │                                                          │ `expires` against now       │
      │                                                          │                            │
      │                                                          ├──── match, not expired ────▶│  200 + file bytes
      │                                                          │                            │
      │                                                          ├──── mismatch/expired ──────▶│  403 Forbidden
```

---

## 6. Why this depends on the Storage Service already existing

The PRD's roadmap (Section 7) lists Stage 10 as depending on Stage 5 (Storage Service), and the EDD's Development Order (Section 11, step 10.1) says the same thing explicitly: `Depends: 5.2` (object upload). The reasoning is direct rather than subtle:

- A signed URL is a signed URL *for an object*. Without the Storage Service already managing buckets and objects (Stage 5), there is nothing to generate a signed URL *about* — no object metadata, no bucket, no `POST /buckets/:id/objects/:key/sign` endpoint to attach the feature to.
- The signing endpoint is naturally a new capability bolted onto the Storage Service's existing object-management API, not a standalone service. Building it before the Storage Service exists would mean building a placeholder API with no real objects behind it — wasted, throwaway work, the same anti-pattern the beginners doc calls out when explaining why the CDN Service was built after the Edge Proxy (Stage 4 depending on Stage 3).
- Symmetrically, signed URL *verification* depends on the Edge Proxy already existing (Stage 3) and already knowing how to serve push-zone objects from MinIO, since the EDD's step 10.2 is explicitly "verify signed URL signature" as an addition to the Edge Proxy's existing request-handling path, not a new service.

---

## 7. A note on the roadmap ordering

While researching this feature, two of the specs disagree about *which month* Signed URLs belong to:

- The EDD's Feature Checklist (Section 1) lists "Signed URLs (private content)" under **Month 6**.
- The EDD's own Development Roadmap (Section 10, Month 4 tasks) and Development Order (Section 11, "10. SIGNED URLS") both place signed URL generation and verification in **Month 4**, sequenced as Stage 10 of 16 — well before RBAC/Security (Stage 11, Month 6).

This is a known, pre-existing inconsistency in the source documents, not something this document resolves. Per the PRD's own Risks & Assumptions table (Section 8) and its Section 7 roadmap table, **the PRD's Section 7 stage table is the authoritative source for stage sequencing** whenever the EDD's month-based roadmap (Section 10) and dependency-based order (Section 11) disagree. The PRD places Signed URLs as Stage 10, target Month 4, depending on Stage 5 — consistent with the EDD's Section 11 dependency order. See [`superpowers/specs/2026-07-25-revocloud-phase1-prd.md`, Section 7](../superpowers/specs/2026-07-25-revocloud-phase1-prd.md) for the full table.

---

## 8. What was actually built

The signature scheme is exactly the one above: `sig = hex(HMAC-SHA256(secret, "{expires}:{path}"))`, where `path` is the decoded URL path. The Node signer and the Go verifier share fixed test vectors, so a change on one side breaks both test suites. A few details the design documents leave open were settled like this:

| Question | What the code does |
|---|---|
| Which requests need a signature? | A per-zone switch, `pull_zones.signed_urls_required` ("Require signed URLs" on the zone page). On such a zone the Edge Proxy checks **every** request, whatever the method, before it touches the cache or the origin. Other zones ignore `expires`/`sig` entirely. |
| Where does the secret come from? | Turning the switch on generates a random 32-byte secret. It is stored AES-256-GCM-encrypted (key: `ZONE_SECRET_ENCRYPTION_KEY`), not bcrypt-hashed as the schema comment suggested, because HMAC needs the original secret back. It is never returned by any API; responses only say `hasSigningSecret`. |
| How does the edge get the secret? | Inside the zone's existing `zone_config:{id}` Redis document, published only while the switch is on. The Edge Proxy already caches that document for 60 seconds and drops it on a `config.zones.updated` NATS nudge, which is the caching and rotation behaviour Section 4 describes. |
| Who signs? | `POST /api/v1/buckets/:bucketId/objects/:key/sign` on the Storage Service checks the bucket and object (it must be fully uploaded), then asks the CDN Service to sign through `POST /internal/zones/:zoneId/signed-urls`. Only the CDN Service can decrypt the secret. The request names the `zoneId` because buckets and zones aren't linked in the data model, so the zone's origin must serve the bucket's objects at `/{key}`. |
| Which host is in the URL? | The zone's active custom domain (always `https`) if it has one, otherwise its default `{slug}-{id}.cdn…` host. |
| Expiry limits | Default 15 minutes, minimum 60 seconds, maximum 7 days. Signing is refused (`409`) for a zone that doesn't require signatures, since that link would only *look* protected. |
| Rotation | `POST /api/v1/zones/:zoneId/signing-secret/rotate` ("Rotate signing secret" on the zone page). Every previously issued link stops working as soon as edges receive the nudge, typically within a second. Turning the switch off keeps the secret, so turning it back on revives links that haven't expired yet. |
| Caching | After a signature checks out, the edge strips `expires`, `sig`, `download` and `filename` from the query. Every signed link for one object therefore shares one cache entry, and the origin never sees the signature. The response's `Cache-Control` is rewritten to `private` with `max-age` capped at the time left on the link, so browsers and proxies can't keep serving it after it expires. Failed checks return `403` with `Cache-Control: no-store`. |
| Modifiers | `download=1` and `filename=` are supported (the filename is sanitized). They sit outside the signed message because they only change how an already-authorized response is presented. The `ip=` restriction is **not** implemented yet: it would have to be covered by the signature (changing the message format) and needs a trustworthy client-IP source, which Phase 1 doesn't have. |

In the dashboard, the zone page has the "Require signed URLs" switch and the rotate button, and each uploaded file in Storage has a **Share link** action that picks a signing zone, an expiry, and optionally forced download, then shows the link with a copy button.

---

## 9. Quick reference

| Concept | One-line meaning |
|---|---|
| Signed URL | A URL carrying its own expiration + signature, granting temporary access to a private object without login. |
| HMAC-SHA256 | The specific signing algorithm: a secret key + a message produce a signature that only someone with the same key can reproduce or verify. |
| Zone signing secret | The secret key behind the HMAC — stored encrypted in PostgreSQL, cached in Redis (60s TTL) for the Edge Proxy, rotated via a NATS event. |
| `expires` | A Unix timestamp; the Edge Proxy rejects any request where `now > expires`. |
| `sig` | The hex-encoded HMAC-SHA256 output over `expires:path`; the Edge Proxy recomputes and compares it. |
| Generation (`POST /objects/:key/sign`) | Happens in the **Storage Service** — a Control Plane action, requires normal auth. |
| Verification | Happens in the **Edge Proxy** — a Data Plane action, requires zero control-plane round-trips per request. |

**The one-line summary:** a signed URL smuggles its own proof of authorization — a resource path, an expiration, and an HMAC-SHA256 signature computed with a secret only RivoCloud's backend holds — directly into the URL's query string, so the Edge Proxy can grant or deny access to a private object entirely on its own, in microseconds, without ever having to ask the Storage Service "is this still allowed?"
