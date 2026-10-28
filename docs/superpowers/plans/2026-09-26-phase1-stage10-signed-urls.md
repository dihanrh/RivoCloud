# Phase 1 — Stage 10: Signed URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can generate a time-limited, HMAC-SHA256-signed URL for a private object, and the Edge Proxy rejects expired or tampered signatures with `403` — matching the PRD's Stage 10 roadmap row exactly: "Signed URLs — HMAC generation + edge verification" (EDD Section 11, steps 10.1 and 10.2).

**Architecture:** A pull zone gains a `signed_urls_required` flag. Turning it on makes the CDN Service generate a random per-zone signing secret, store it AES-256-GCM-encrypted in `pull_zones.signing_secret`, and publish it (decrypted) plus the flag inside the zone's existing `zone_config:{id}` Redis document. The Edge Proxy's `RedisRegistry` already caches that document for 60s and evicts it on a `config.zones.updated` NATS nudge, which is exactly the EDD Section 5.5 secret-caching and rotation contract, so no new cache or subscriber is needed. On a zone that requires signatures, the Edge Proxy verifies `expires` and `sig` on every request before it touches the cache or the origin. It answers `403` on failure, and on success strips the signing parameters so every signed URL for one object shares a single cache entry. Generation is `POST /api/v1/buckets/:bucketId/objects/:key/sign` on the Storage Service. That service checks bucket and object ownership, then asks the CDN Service to sign through a new internal endpoint (`POST /internal/zones/:zoneId/signed-urls`). The signing secret therefore never leaves the CDN Service except through Redis to the edge.

**Tech Stack:** Go 1.23 (edge-proxy, via the existing `scripts/go-docker.sh` wrapper; standard-library `crypto/hmac` and `crypto/sha256`, no new module), NestJS 10 (`cdn-service`, `storage-service`), Node `node:crypto` (`createHmac`, `createCipheriv('aes-256-gcm')`, `randomBytes`, `timingSafeEqual`), Prisma migration (`@rivocloud/db`), Next.js 15 dashboard (TanStack Query hooks and proxy routes, following the existing zone and storage patterns).

**Spec:**
- [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md): Section 5.6 (Signed URLs), Section 7 (Roadmap, Stage 10)
- [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md): Section 5.5 (signature scheme, secret caching, optional modifiers), Section 7 (`POST /api/v1/buckets/:bucketId/objects/:key/sign`), Section 11 block 10 (10.1, 10.2)
- [`docs/concepts/signed-urls-and-hmac.md`](../../concepts/signed-urls-and-hmac.md): the beginner walkthrough this plan implements

## Global Constraints

- The signature scheme is exactly EDD Section 5.5: `message = expires_unix + ":" + path`, `sig = hex(HMAC-SHA256(zone_secret, message))`, carried as `?expires=<unix seconds>&sig=<lowercase hex>`. `path` is the **decoded** URL path, the same value Go's `r.URL.Path` produces, so the Storage Service signs `"/" + key` and percent-encodes each segment only when it builds the URL string.
- Verification makes zero control-plane round-trips per request. The Edge Proxy only ever reads the secret from its already-cached zone config.
- The signing secret never appears in any API response, dashboard payload, or log line, which carries Stage 4's rule forward. Only the CDN Service can decrypt it, and it only leaves that service through `zone_config:{id}` in Redis.
- Signature comparison is constant-time on both sides: `hmac.Equal` in Go and `timingSafeEqual` in Node.
- API routes are versioned `/api/v1/...`; the internal route is `/internal/zones/:zoneId/signed-urls`, guarded by `X-Internal-Secret` exactly like `scheduler`'s `/internal/domains/...`.
- No shared TypeScript package for business logic. The Storage Service's `CdnClient` is its own small class, modelled on `cdn-service`'s `SchedulerClient`.
- This dev machine has no native Go toolchain: every Go command runs through `bash apps/edge-proxy/scripts/go-docker.sh <cmd>` (wired into `pnpm --filter @rivocloud/edge-proxy test:unit` and `test:integration`).

## Design Decisions (read before starting)

These resolve ambiguity the source docs leave open. Each one is a deliberate, scoped choice, not a placeholder.

1. **Buckets and zones have no relationship in the schema, so the caller names the zone.** The sign request body carries a `zoneId`. The CDN Service checks that the zone belongs to the caller's org, that it requires signed URLs, and that it has a secret, and it builds the URL from the zone's own hostname. The zone's origin must serve the bucket's objects at `/{key}`. That is a customer configuration concern, the same way any pull zone's origin is. Adding a bucket-to-zone link column would be a data-model decision outside this stage's two EDD steps.
2. **"Signed URLs required" is a per-zone flag, not a per-path rule.** EDD Section 3's zone lookup lists `signed_url_required` as a zone attribute, so a new `pull_zones.signed_urls_required BOOLEAN NOT NULL DEFAULT false` column is added (the only migration in this stage). Per-path signing, for example through a cache-rule action, is out of scope.
3. **The secret is encrypted at rest with AES-256-GCM, not bcrypt.** The schema comment says "(bcrypt)", but HMAC verification needs the raw secret, and a one-way hash cannot supply it. The EDD's own Section 5.5 says "encrypted at rest", which is what this stage implements. The key is a new `ZONE_SECRET_ENCRYPTION_KEY` env var (64 hex chars = 32 bytes), read only by the CDN Service. The stored format is `v1:<iv b64>:<tag b64>:<ciphertext b64>` so a future key rotation can be versioned.
4. **Signing happens in the CDN Service, reached from the Storage Service through an internal endpoint.** EDD 10.1 puts the endpoint on the Storage Service, and it stays there because object ownership lives there. But the secret belongs to the zone, which the CDN Service owns. Having the Storage Service read and decrypt `pull_zones.signing_secret` directly would spread the encryption key to a second service. So the Storage Service validates the bucket and object, then calls `POST /internal/zones/:zoneId/signed-urls` with `{ orgId, path, expires }`. The CDN Service checks zone ownership, signs, and returns `{ url }`.
5. **Enabling the flag generates a secret; rotation is an explicit action.** `PATCH /zones/:id { signedUrlsRequired: true }` creates a 32-byte random secret if the zone has none. `POST /api/v1/zones/:id/signing-secret/rotate` replaces it. Both republish `zone_config` and emit `config.zones.updated`, so edges drop their cached copy immediately rather than after 60s. Rotation invalidates every outstanding signed URL for the zone, and that is its purpose. Turning the flag off keeps the secret, so turning it back on revives URLs that have not yet expired.
6. **Signing requires the flag.** Signing a URL for a zone that does not verify signatures would hand out a link that looks protected but isn't. The internal endpoint returns `409 Conflict` in that case, and the Storage Service passes the 409 through.
7. **The edge strips `expires`, `sig`, `download`, and `filename` after a successful verification.** Otherwise every freshly signed URL would be a distinct cache key (a guaranteed miss) and the parameters would leak to the origin. Verification runs on the raw query before stripping.
8. **Every method is verified on a signed zone, not just GET and HEAD.** A zone that requires signatures should not let a write or an `OPTIONS` through unsigned. The 403 is still recorded as an analytics event with cache status `BYPASS`.
9. **The downstream cache lifetime is capped at the signature's own expiry.** When the edge answers a signed request, it rewrites the response `Cache-Control`: `public` and `s-maxage` are dropped, `private` is added, and `max-age` is capped to the seconds left until `expires`. A browser or shared proxy therefore never keeps serving an object after the link has expired. `no-store` responses are left untouched.
10. **`download=1` and `filename=` are implemented; `ip=` is deferred.** The two download modifiers only change `Content-Disposition` on a response the signature already authorized, so they are safe to leave unsigned. The filename is sanitized: quotes, backslashes, and control characters are stripped, and it is sent both as a plain `filename` and as RFC 5987 `filename*`. An `ip=` restriction is only meaningful if the IP is covered by the signature, which would change the EDD's `expires:path` message format. It needs a real client-IP source (Phase 1 has no trusted proxy chain yet), so it is left for a later stage.
11. **Expiry bounds.** `expiresIn` defaults to 900 seconds (the concept doc's "15 minutes"), with a minimum of 60 and a maximum of 604800 (7 days, matching S3 presigned URL limits). The object must be `ready`; a `pending` upload returns `409`.

## File Structure

```
packages/db/prisma/schema.prisma                                   # modified: PullZone.signedUrlsRequired
packages/db/prisma/migrations/20260926000000_add_zone_signed_urls/migration.sql   # new

apps/cdn-service/src/env.ts                                         # modified: + ZONE_SECRET_ENCRYPTION_KEY, CDN_URL_SCHEME
apps/cdn-service/src/signing/
  secret-box.ts, secret-box.test.ts                                 # AES-256-GCM encrypt/decrypt + generateSigningSecret
  url-signer.ts, url-signer.test.ts                                 # HMAC-SHA256 signature + URL builder
apps/cdn-service/src/zones/
  zone-response.util.ts                                             # modified: + hasSigningSecret, still omits the secret
  zone-config.publisher.ts                                          # modified: + signedUrlsRequired, signingSecret
  zones.service.ts, zones.controller.ts                             # modified: flag handling + rotate endpoint
  dto/create-zone.dto.ts, dto/update-zone.dto.ts                    # modified: + signedUrlsRequired
  zone-hostname.ts                                                  # new: hostFor() shared by publisher + signer
apps/cdn-service/src/signed-urls/
  internal-auth.guard.ts
  dto/sign-url-internal.dto.ts
  signed-urls-internal.controller.ts, signed-urls.service.ts
  signed-urls-internal.controller.integration.test.ts
  signed-urls.module.ts

apps/storage-service/src/env.ts                                     # modified: + CDN_SERVICE_URL
apps/storage-service/src/cdn/cdn-client.ts, cdn-client.test.ts, cdn-client.provider.ts
apps/storage-service/src/objects/dto/sign-object.dto.ts
apps/storage-service/src/objects/objects.service.ts                 # modified: + sign()
apps/storage-service/src/objects/objects.controller.ts              # modified: + POST :key/sign

apps/edge-proxy/internal/signedurl/signedurl.go, signedurl_test.go  # Verify, Strip, Disposition, CapCacheControl
apps/edge-proxy/internal/zone/zone.go, redis_registry.go            # modified: + SignedURLsRequired, SigningSecret
apps/edge-proxy/internal/proxy/handler.go                           # modified: verify before cache/origin
apps/edge-proxy/internal/proxy/handler_signedurl_integration_test.go  # new

apps/dashboard/src/lib/types.ts                                     # modified
apps/dashboard/src/app/api/zones/[zoneId]/signing-secret/rotate/route.ts           # new
apps/dashboard/src/app/api/buckets/[bucketId]/objects/[key]/sign/route.ts          # new
apps/dashboard/src/hooks/use-rotate-signing-secret.ts, use-sign-object.ts          # new
apps/dashboard/src/components/zones/zone-detail.tsx                 # modified: signed URL toggle + rotate
apps/dashboard/src/components/storage/share-link-dialog.tsx         # new
apps/dashboard/src/components/storage/object-browser.tsx            # modified: "Share link" action

.env.example, .github/workflows/ci.yml, turbo.json                  # modified: new env vars
docs/concepts/signed-urls-and-hmac.md                               # modified: "built" status + as-built notes
docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md           # modified: Stage 10 done
```

## Tasks

Each task ends with its own commit.

### Task 1: Database — `pull_zones.signed_urls_required`
- [ ] Add `signedUrlsRequired Boolean @default(false) @map("signed_urls_required")` to `PullZone`.
- [ ] Add the migration `ALTER TABLE "pull_zones" ADD COLUMN "signed_urls_required" BOOLEAN NOT NULL DEFAULT false;`.
- [ ] `prisma migrate deploy` and `prisma generate`; the `cdn-service` typecheck and integration suite stay green.

### Task 2: CDN Service — secret encryption and URL signing primitives
- [ ] `secret-box.ts`: `generateSigningSecret()` (32 random bytes, hex), `encryptSecret(plain, keyHex)`, `decryptSecret(stored, keyHex)` (AES-256-GCM, `v1:` format; throws on a tampered tag or unknown version).
- [ ] `url-signer.ts`: `signPath(secret, path, expires)` returns lowercase hex; `buildSignedUrl({ scheme, host, path, expires, sig })` percent-encodes each path segment.
- [ ] Unit tests: round-trip, tamper detection, wrong key, and a fixed-vector signature computed independently, which the Go test must reproduce byte-for-byte.
- [ ] `env.ts`: `ZONE_SECRET_ENCRYPTION_KEY` (regex `^[0-9a-f]{64}$`), `CDN_URL_SCHEME` (`http` or `https`, default `https`). Add them to `.env.example`, the CI env, and the turbo `test:integration` env allowlist.

### Task 3: CDN Service — zone signed-URL settings, rotation, and publication
- [ ] Extract `hostFor(zone, rootDomain)` into `zone-hostname.ts` (the publisher and the signer must agree on the host).
- [ ] `CreateZoneDto` / `UpdateZoneDto`: optional `signedUrlsRequired: boolean`. Turning it on with no stored secret generates and encrypts one.
- [ ] `POST /api/v1/zones/:zoneId/signing-secret/rotate` (`write` scope) generates a new secret, republishes, and returns the zone.
- [ ] `toZoneResponse` still omits `signingSecret` and adds a derived `hasSigningSecret` boolean.
- [ ] `ZoneConfigPublisher` adds `signedUrlsRequired` to `zone_config`, plus `signingSecret` (decrypted) only when the flag is on.
- [ ] Integration tests: enabling generates an encrypted secret (the DB value is not the plaintext and decrypts to the Redis value); rotate changes it; responses never contain the secret; the flag off leaves no secret in Redis.

### Task 4: CDN Service — internal signing endpoint
- [ ] `POST /internal/zones/:zoneId/signed-urls` with `{ orgId: uuid, path: string starting "/", expires: int }` and the `X-Internal-Secret` guard.
- [ ] 404 for an unknown zone or another org's zone; 409 when the zone does not require signed URLs or has no secret; otherwise `{ url }`, using the primary active custom domain's host if there is one, else the default zone host.
- [ ] Integration tests: missing/incorrect secret → 401; cross-org → 404; flag off → 409; the success case returns a URL whose `sig` verifies against the decrypted secret.

### Task 5: Storage Service — `POST /api/v1/buckets/:bucketId/objects/:key/sign`
- [ ] `CDN_SERVICE_URL` env (default `http://localhost:3003`); `CdnClient.signUrl(zoneId, body)` maps 404/409 through and anything else (or a network error) to 503.
- [ ] `SignObjectDto`: `zoneId` (uuid), `expiresIn` (60–604800, default 900), `download` (bool), `filename` (≤ 255 chars).
- [ ] `ObjectsService.sign()`: bucket ownership; latest object exists, is not deleted, and is `ready` (409 otherwise); computes `expires`; calls the CDN client; appends `download`/`filename`; returns `{ url, expiresAt }`.
- [ ] `read` storage scope on the route.
- [ ] Unit tests for `CdnClient` (fetch stubbed); integration tests with a fake `CdnClient` for ownership, the pending object → 409, and the success shape.

### Task 6: Edge Proxy — `internal/signedurl` package
- [ ] `Verify(query url.Values, path, secret string, now time.Time) error`: missing params, an unparseable or expired `expires`, or a signature mismatch each return a distinct sentinel error; the comparison uses `hmac.Equal`.
- [ ] `Strip(rawQuery string) string` removes `expires`, `sig`, `download`, and `filename`, preserving the order of the other parameters.
- [ ] `ContentDisposition(query url.Values) (string, bool)` for `download=1` and a sanitized `filename`.
- [ ] `CapCacheControl(value string, remaining time.Duration) string` implements Design Decision 9.
- [ ] Unit tests, including the same fixed vector as the Node signer.

### Task 7: Edge Proxy — enforce signed URLs in the request pipeline
- [ ] `zone.Config` gains `SignedURLsRequired bool` and `SigningSecret string`; `redisConfig` parses `signedUrlsRequired` / `signingSecret`. A zone that requires signing but has an empty secret fails closed (every request gets 403).
- [ ] `CachingHandler.ServeHTTP`: right after zone resolution, when `z.SignedURLsRequired`, verify → 403 on failure; on success clone the request with the stripped query and wrap the response writer so `Content-Disposition` and the capped `Cache-Control` are applied at `WriteHeader`.
- [ ] Integration tests: valid → 200 and the origin sees no signing params; expired → 403; tampered path/sig → 403; two different valid signatures share one cache entry; unsigned zones are unaffected; `download=1` sets `Content-Disposition`; `Cache-Control` is capped; the Redis registry parses the new fields.

### Task 8: Dashboard — signed URL controls
- [ ] Types: `Zone.signedUrlsRequired`, `Zone.hasSigningSecret`, `SignedUrlResponse`.
- [ ] Proxy routes: `POST /api/zones/[zoneId]/signing-secret/rotate` and `POST /api/buckets/[bucketId]/objects/[key]/sign`.
- [ ] Zone detail: a "Require signed URLs" switch (through the existing `useUpdateZone`) and a "Rotate signing secret" button with a confirm step that warns existing links stop working.
- [ ] Object browser: a "Share link" action opening a dialog (zone select limited to signing-enabled zones, expiry select, download checkbox) that shows the generated URL with a copy button.
- [ ] Component tests for the new dialog and the zone toggle.

### Task 9: Docs — mark Stage 10 done
- [ ] PRD Section 7: Stage 10 → ✅ Done.
- [ ] `signed-urls-and-hmac.md`: replace the "not built yet" banner with an as-built summary (per-zone flag, internal signing hop, stripped params, deferred `ip=`).
