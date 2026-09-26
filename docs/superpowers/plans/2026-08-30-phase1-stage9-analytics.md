# Phase 1 — Stage 9: Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every request the Edge Proxy handles (hit or miss) becomes a `edge.request` NATS event; a new Analytics Service batches those events into ClickHouse, serves 8 aggregation endpoints, and the Scheduler pre-computes hourly/daily rollups — with the Dashboard rendering bandwidth, cache-hit-ratio, latency, geography, and status-code charts, matching the PRD's Stage 9 roadmap row exactly: "Analytics — edge events to NATS, ClickHouse ingestion, charts."

**Architecture:** The Go Edge Proxy gains a small `internal/analytics` package that publishes one JSON event per request to NATS subject `edge.request`, fire-and-forget, from a `CachingHandler` instrumented to capture status code, byte count, and cache outcome (EDD Section 2.5, Section 11 block 9.1). A new NestJS `apps/analytics-service` (mirroring `apps/scheduler`'s scaffold from Stage 8) subscribes to `edge.request`, buffers events in memory, and bulk-inserts into ClickHouse's `request_logs` table every 1,000 events or 5 seconds — whichever first (9.2) — then serves 8 read-only `/api/v1/analytics/*` endpoints or aggregation queries (9.3), scoped to the zones the caller's org owns via a Prisma lookup (ClickHouse itself has no notion of org/zone ownership beyond raw dimension columns). The existing `apps/scheduler` service gains a `@Cron`-driven hourly/daily rollup that pre-computes `bandwidth_hourly` and `requests_by_country_daily` from `request_logs`, matching the EDD's stated scaling strategy. The Dashboard gets a new top-level `/analytics` page with Recharts-based charts (9.4), backed by 8 thin Next.js proxy routes and TanStack Query hooks, following the exact patterns already used for `/zones`.

**Tech Stack:** Go 1.23 (edge-proxy, via the existing `scripts/go-docker.sh` Docker wrapper — this dev machine has no native Go toolchain), `github.com/nats-io/nats.go` (already a dependency, no new Go module needed), NestJS 10 (`apps/analytics-service` is a new service built exactly like `apps/scheduler`), `@clickhouse/client` (new dependency — the official ClickHouse Node.js client), `nats` (`^2.28.2`, already used by `cdn-service`), `@rivocloud/db` (Prisma, for zone/org ownership checks only — ClickHouse is the analytics store, Postgres is not), `@nestjs/schedule` (already a `scheduler` dependency), Next.js 15 dashboard with a new `recharts` dependency (no chart library exists in the dashboard today).

**Spec:**
- [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md) — Section 5.7 (Analytics), Section 7 (Roadmap, Stage 9)
- [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md) — Section 2.5 (Analytics Service), Section 6.6 (ClickHouse tables), Section 7.7 (Analytics endpoints), Section 7.9 (internal batch-ingest endpoint), Section 11 block 9 (development order 9.1–9.4)
- [`docs/concepts/analytics-and-clickhouse.md`](../../concepts/analytics-and-clickhouse.md) — the beginner walkthrough this plan implements end-to-end

## Global Constraints

- API routes are versioned `/api/v1/...`; the internal batch-ingest endpoint is `/internal/analytics/events` (unversioned, per EDD Section 7.9, matching `/internal/zones/config` and friends).
- Every analytics query is org-scoped: a caller only ever sees data for zones owned by their own `orgId`. ClickHouse's `zone_id` column (present on all three tables) is resolved to a caller's owned zone IDs via `@rivocloud/db`'s Prisma `PullZone` model before every query — ClickHouse itself enforces no ownership.
- The `edge.request` NATS event schema (EDD Section 2.5) is exact and non-negotiable: `timestamp, zone_id, org_id, datacenter, method, path, status_code, cache_status, bytes_sent, duration_ms, country, client_ip_hash` — snake_case JSON keys, published by the Go edge-proxy, consumed by the NestJS analytics-service.
- Ingestion batches flush at exactly 1,000 events or 5 seconds, whichever first (EDD Section 2.5) — these are fixed constants, not configurable via env vars.
- No shared TypeScript package between services for auth or business logic — `apps/analytics-service` duplicates `apps/cdn-service`'s `auth/` module (IdentityClient, AuthGuard, AuthContext) rather than importing it, matching the convention already established between `cdn-service` and `scheduler` in Stage 8.
- This dev machine has no native Go toolchain — every Go command for the edge-proxy task runs through `bash apps/edge-proxy/scripts/go-docker.sh <cmd>` (already wired into `pnpm --filter @rivocloud/edge-proxy test:unit`/`test:integration`).
- Docker Desktop must be running for edge-proxy Go tests (they run inside a `golang:1.23-alpine` container) and for any NestJS integration test that talks to Postgres/Redis/NATS/ClickHouse (`docker compose -f infrastructure/compose/docker-compose.infra.yml up -d postgres redis nats clickhouse`).
- No new Go module dependency is needed for the edge-proxy changes in this stage (NATS publish uses the existing `nats.go` dependency; country resolution needs no GeoIP library — see Design Decision 3).

## Design Decisions (read before starting)

These resolve ambiguity the source docs leave open. Each is a deliberate, scoped choice — not a placeholder:

1. **`org_id` is already published to Redis by the CDN Service's `ZoneConfigPublisher` but silently dropped by the Go edge-proxy today.** `zone.Config`/the internal `redisConfig` struct gain an `OrgID` field (Task 1) so it's available on the hot path without an extra lookup.
2. **Request timing and byte-count are not currently captured anywhere in `handler.go`'s hot path.** A `statusRecorder` wrapping `http.ResponseWriter` (capturing status code and bytes written) plus a `start := h.now()` captured at the top of `ServeHTTP` are added (Task 3) — this is genuinely new instrumentation, not a refactor of existing logic.
3. **No GeoIP infrastructure exists anywhere in this codebase, and Phase 1 has no distributed edge yet (that's Stage 12).** Rather than introduce a MaxMind/GeoIP dependency and a license-gated database this dev/CI environment can't reliably provide, `country` is read from an optional `X-RivoCloud-Country` request header (the seam a future GeoDNS/load-balancer layer, or a test, would set) and falls back to a configurable default (`EDGE_DEFAULT_COUNTRY`, default `"ZZ"` for unknown) — an accepted Phase 1 tradeoff, exactly like Stage 8 accepting that TLS cert issuance can't complete locally without real DNS.
4. **ClickHouse table ownership and schema application:** both `apps/analytics-service` and `apps/scheduler` run the same idempotent `CREATE TABLE IF NOT EXISTS` statements on boot (a small duplicated `clickhouse/schema.ts`, matching the "no shared package" convention) rather than relying on migration tooling — ClickHouse has no Prisma-equivalent in this repo, and both services need the tables to exist for their own integration tests to run in isolation.
5. **`requests_by_country_daily` has no `org_id` column (EDD Section 6.6's schema only has `zone_id`).** Every analytics query — not just geography — resolves the caller's owned zone IDs from Postgres first (`zoneIdsForOrg`) and filters ClickHouse with `zone_id IN {zoneIds:Array(String)}` uniformly. This sidesteps the missing-column mismatch entirely and is simpler than filtering three tables three different ways.
6. **Rollups are computed with ClickHouse's own `INSERT INTO ... SELECT ... GROUP BY`, not fetch-then-reinsert in Node.** `SummingMergeTree` merges same-key rows automatically in the background; issuing one `command()` per rollup window is both simpler and avoids ever holding a full hour of raw rows in Node memory.
7. **The internal `POST /internal/analytics/events` endpoint (EDD Section 7.9) is built for completeness and reuses the same `RequestLogWriter.insertBatch`** the NATS ingestion path uses — it is not the edge-proxy's actual ingestion path (that's NATS), but the EDD explicitly lists it as an internal API and it gives the pipeline a testable HTTP entry point independent of NATS.
8. **Bandwidth and geography endpoints query the pre-computed rollup tables (`bandwidth_hourly`, `requests_by_country_daily`)**, matching the concept doc's walkthrough ("The Analytics Service serves that query straight from the pre-computed bandwidth_hourly table"). The other six endpoints (overview, requests, cache, latency, status-codes, top-paths) query `request_logs` directly — no rollup table is defined for them in the EDD, and their required granularity (per-status-code, percentiles, per-path) isn't rollup-friendly at Phase 1 scale.

## File Structure

```
apps/edge-proxy/internal/zone/zone.go                          # modified: + OrgID field
apps/edge-proxy/internal/zone/redis_registry.go                # modified: + OrgID parsing
apps/edge-proxy/internal/zone/redis_registry_integration_test.go  # modified: + OrgID test
apps/edge-proxy/internal/analytics/
  event.go, event_test.go
  publisher.go, publisher_test.go
apps/edge-proxy/internal/proxy/handler.go                       # modified: statusRecorder, recordEvent
apps/edge-proxy/internal/proxy/handler_analytics_integration_test.go  # new
apps/edge-proxy/cmd/edge-proxy/main.go                          # modified: wire analytics.Connect
.env.example                                                     # modified: + EDGE_DEFAULT_COUNTRY, Analytics Service section
infrastructure/compose/docker-compose.infra.yml                  # modified: + clickhouse healthcheck
.github/workflows/ci.yml                                         # modified: + clickhouse service
turbo.json                                                        # modified: + CLICKHOUSE_URL env allowlist

apps/analytics-service/                                          # new NestJS service
  package.json, tsconfig.json, .swcrc, vitest.config.ts, vitest.integration.config.ts
  src/
    main.ts, app.module.ts, app-env.token.ts, env.ts, env.module.ts
    prisma/prisma.module.ts
    health/health.controller.ts, health.controller.integration.test.ts
    clickhouse/
      clickhouse.module.ts, clickhouse.token.ts
      schema.ts, schema.service.ts, schema.service.integration.test.ts
    auth/
      auth-context.decorator.ts, identity-client.ts, identity-client.test.ts,
      identity-client.provider.ts, auth-guard.ts, auth-guard.test.ts,
      analytics-access.guard.ts, analytics-access.guard.test.ts, auth.module.ts
    ingestion/
      edge-request-event.ts, parse-event.ts, parse-event.test.ts
      request-log-writer.ts, request-log-writer.integration.test.ts
      ingestion.service.ts, ingestion.service.test.ts, ingestion.service.integration.test.ts
      ingestion.module.ts
      internal-auth.guard.ts
      events-internal.dto.ts, events-internal.controller.ts, events-internal.controller.integration.test.ts
      ingestion-internal.module.ts
    analytics/
      dto/analytics-query.dto.ts
      analytics.service.ts, analytics.service.integration.test.ts
      analytics.controller.ts, analytics.controller.integration.test.ts
      analytics.module.ts

apps/scheduler/package.json                                      # modified: + @clickhouse/client
apps/scheduler/src/env.ts                                        # modified: + CLICKHOUSE_URL
apps/scheduler/src/app.module.ts                                 # modified: + AnalyticsRollupModule
apps/scheduler/src/clickhouse/                                   # new (duplicated from analytics-service)
  clickhouse.module.ts, clickhouse.token.ts, schema.ts, schema.service.ts
apps/scheduler/src/analytics/
  rollup.service.ts, rollup.service.integration.test.ts
  rollup.cron.ts, rollup.cron.test.ts
  analytics-rollup.module.ts

apps/dashboard/package.json                                      # modified: + recharts
apps/dashboard/src/lib/env.ts                                    # modified: + ANALYTICS_SERVICE_URL
apps/dashboard/src/lib/types.ts                                  # modified: + analytics response types
apps/dashboard/src/app/api/analytics/overview/route.ts            # new
apps/dashboard/src/app/api/analytics/bandwidth/route.ts           # new
apps/dashboard/src/app/api/analytics/requests/route.ts            # new
apps/dashboard/src/app/api/analytics/cache/route.ts               # new
apps/dashboard/src/app/api/analytics/geography/route.ts           # new
apps/dashboard/src/app/api/analytics/latency/route.ts             # new
apps/dashboard/src/app/api/analytics/status-codes/route.ts        # new
apps/dashboard/src/app/api/analytics/top-paths/route.ts           # new
apps/dashboard/src/hooks/use-analytics.ts, use-analytics.test.ts  # new
apps/dashboard/src/components/analytics/
  analytics-filters.tsx, analytics-filters.test.tsx
  bandwidth-chart.tsx, cache-ratio-gauge.tsx, geography-table.tsx, geography-table.test.tsx
  status-code-chart.tsx, latency-chart.tsx
apps/dashboard/src/app/(app)/analytics/page.tsx                  # new
apps/dashboard/src/components/layout/app-shell.tsx               # modified: + nav item

docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md        # modified: mark Stage 9 done
docs/concepts/analytics-and-clickhouse.md                        # modified: remove "not built yet" caveat
```

---

### Task 1: Edge Proxy — resolve `org_id` from `zone_config` into `zone.Config`

**Files:**
- Modify: `apps/edge-proxy/internal/zone/zone.go`
- Modify: `apps/edge-proxy/internal/zone/redis_registry.go`
- Test: `apps/edge-proxy/internal/zone/redis_registry_integration_test.go`

**Interfaces:**
- Produces: `zone.Config.OrgID string` — consumed by Task 3's `recordEvent`.

- [ ] **Step 1: Write the failing test**

Append to `apps/edge-proxy/internal/zone/redis_registry_integration_test.go`:

```go
func TestRedisRegistry_ResolvesOrgID(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "org-zone.cdn.rivocloud.dev", "zone-org-1", redisConfig{
		ID: "zone-org-1", Slug: "org-zone", OriginURL: "https://api.example.com",
		OrgID: "org-abc123", CacheTTL: 3600, Enabled: true,
	})

	registry := NewRedisRegistry(client)
	cfg, ok := registry.Resolve("org-zone.cdn.rivocloud.dev")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if cfg.OrgID != "org-abc123" {
		t.Fatalf("expected OrgID %q, got %q", "org-abc123", cfg.OrgID)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (requires Docker Desktop running and `docker compose -f infrastructure/compose/docker-compose.infra.yml up -d redis`): `cd apps/edge-proxy && bash scripts/go-docker.sh go test -tags=integration ./internal/zone/... -run TestRedisRegistry_ResolvesOrgID -v`
Expected: FAIL with a compile error — `unknown field OrgID in struct literal of type redisConfig` (and `cfg.OrgID undefined`).

- [ ] **Step 3: Add the `OrgID` field**

In `apps/edge-proxy/internal/zone/zone.go`, add to the `Config` struct (after `ID`):

```go
type Config struct {
	ID    string
	Host  string
	// OrgID is the owning organization, read from zone_config:{id}'s
	// "orgId" field (written by the CDN Service's ZoneConfigPublisher).
	// Empty for a Config built by StaticRegistry.
	OrgID      string
	OriginURL  string
	DefaultTTL time.Duration
	Rules      []cacherules.Rule
}
```

In `apps/edge-proxy/internal/zone/redis_registry.go`, add `OrgID` to `redisConfig`:

```go
type redisConfig struct {
	ID             string `json:"id"`
	Slug           string `json:"slug"`
	OrgID          string `json:"orgId"`
	OriginURL      string `json:"originUrl"`
	OriginProtocol string `json:"originProtocol"`
	CacheTTL       int    `json:"cacheTtl"`
	BrowserTTL     int    `json:"browserTtl"`
	Enabled        bool   `json:"enabled"`
}
```

And thread it through in `resolveConfig`:

```go
cfg = Config{ID: rc.ID, OrgID: rc.OrgID, OriginURL: rc.OriginURL, DefaultTTL: time.Duration(rc.CacheTTL) * time.Second}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/edge-proxy && bash scripts/go-docker.sh go test -tags=integration ./internal/zone/... -v`
Expected: PASS (all tests in the package, not just the new one — confirms no regression).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-proxy/internal/zone/
git commit -m "feat(edge-proxy): resolve org_id from zone_config into zone.Config"
```

---

### Task 2: Edge Proxy — `internal/analytics` event + publisher package

**Files:**
- Create: `apps/edge-proxy/internal/analytics/event.go`
- Create: `apps/edge-proxy/internal/analytics/event_test.go`
- Create: `apps/edge-proxy/internal/analytics/publisher.go`
- Create: `apps/edge-proxy/internal/analytics/publisher_test.go`

**Interfaces:**
- Produces: `analytics.Event` struct, `analytics.EventPublisher` interface (`Publish(Event)`), `analytics.Publisher` (implements `EventPublisher`), `analytics.Connect(natsURL string) (*Publisher, error)` — all consumed by Task 3.

- [ ] **Step 1: Write the event struct and its test**

`apps/edge-proxy/internal/analytics/event.go`:

```go
// Package analytics publishes one JSON event per Edge Proxy request to NATS
// subject "edge.request" (EDD Section 2.5), for the Analytics Service to
// batch-insert into ClickHouse.
package analytics

import "time"

// Event mirrors the EDD Section 2.5 edge.request payload exactly — these
// JSON field names are a cross-service contract with the NestJS Analytics
// Service and must not change without updating both sides.
type Event struct {
	Timestamp    time.Time `json:"timestamp"`
	ZoneID       string    `json:"zone_id"`
	OrgID        string    `json:"org_id"`
	Datacenter   string    `json:"datacenter"`
	Method       string    `json:"method"`
	Path         string    `json:"path"`
	StatusCode   int       `json:"status_code"`
	CacheStatus  string    `json:"cache_status"`
	BytesSent    int64     `json:"bytes_sent"`
	DurationMs   int64     `json:"duration_ms"`
	Country      string    `json:"country"`
	ClientIPHash string    `json:"client_ip_hash"`
}
```

`apps/edge-proxy/internal/analytics/event_test.go`:

```go
package analytics

import (
	"encoding/json"
	"testing"
	"time"
)

func TestEvent_MarshalsExpectedJSONFieldNames(t *testing.T) {
	event := Event{
		Timestamp: time.Date(2026, 6, 29, 10, 0, 0, 0, time.UTC), ZoneID: "zone_abc123",
		OrgID: "org_xyz789", Datacenter: "Nuremberg-HZ-1", Method: "GET", Path: "/assets/main.js",
		StatusCode: 200, CacheStatus: "HIT", BytesSent: 45231, DurationMs: 12,
		Country: "DE", ClientIPHash: "sha256hash",
	}

	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	for _, field := range []string{
		"timestamp", "zone_id", "org_id", "datacenter", "method", "path",
		"status_code", "cache_status", "bytes_sent", "duration_ms", "country", "client_ip_hash",
	} {
		if _, ok := decoded[field]; !ok {
			t.Errorf("expected JSON field %q, got keys %v", field, decoded)
		}
	}
	if decoded["zone_id"] != "zone_abc123" {
		t.Errorf("unexpected zone_id: %v", decoded["zone_id"])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/edge-proxy && bash scripts/go-docker.sh go test ./internal/analytics/... -v`
Expected: FAIL — package doesn't compile yet (no `publisher.go`, but `event.go` alone should actually compile and this specific test should PASS once `event.go` exists; if it fails, it's because `event.go` wasn't created — verify the file was saved before moving on).

- [ ] **Step 3: Write the publisher and its test**

`apps/edge-proxy/internal/analytics/publisher.go`:

```go
package analytics

import (
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
)

// EventPublisher is satisfied by *Publisher; tests inject a fake that
// records published events instead of dialing real NATS.
type EventPublisher interface {
	Publish(Event)
}

// Publisher publishes edge.request events to NATS, fire-and-forget — the
// same "NATS unavailable degrades, never blocks the hot path" convention as
// the invalidation and configsync packages.
type Publisher struct {
	nc *nats.Conn
}

// Connect dials NATS once at startup. It always returns a non-nil *Publisher
// (even on error) so callers can wire it into CachingHandler unconditionally
// — Publish becomes a no-op until a connection exists.
func Connect(natsURL string) (*Publisher, error) {
	nc, err := nats.Connect(natsURL)
	if err != nil {
		log.Printf("analytics: NATS unavailable, request events will not be published: %v", err)
		return &Publisher{}, err
	}
	return &Publisher{nc: nc}, nil
}

// Publish is safe to call on a nil *Publisher or one whose connection never
// succeeded — it silently no-ops in both cases.
func (p *Publisher) Publish(event Event) {
	if p == nil || p.nc == nil {
		return
	}
	payload, err := json.Marshal(event)
	if err != nil {
		log.Printf("analytics: failed to marshal edge.request event: %v", err)
		return
	}
	if err := p.nc.Publish("edge.request", payload); err != nil {
		log.Printf("analytics: publish failed: %v", err)
	}
}
```

`apps/edge-proxy/internal/analytics/publisher_test.go`:

```go
package analytics

import "testing"

func TestPublisher_ZeroValuePublishIsANoop(t *testing.T) {
	var p *Publisher
	p.Publish(Event{ZoneID: "zone-1"}) // must not panic
}

func TestPublisher_PublishWithNoConnectionIsANoop(t *testing.T) {
	p := &Publisher{}
	p.Publish(Event{ZoneID: "zone-1"}) // must not panic
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/edge-proxy && bash scripts/go-docker.sh go test ./internal/analytics/... -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-proxy/internal/analytics/
git commit -m "feat(edge-proxy): add analytics package for edge.request NATS events"
```

---

### Task 3: Edge Proxy — instrument `CachingHandler` to publish `edge.request` events

**Files:**
- Modify: `apps/edge-proxy/internal/proxy/handler.go`
- Modify: `apps/edge-proxy/cmd/edge-proxy/main.go`
- Modify: `.env.example`
- Test: `apps/edge-proxy/internal/proxy/handler_analytics_integration_test.go`

**Interfaces:**
- Consumes: `analytics.Event`, `analytics.EventPublisher`, `analytics.Connect` (Task 2); `zone.Config.OrgID` (Task 1).
- Produces: `CachingHandler.Analytics analytics.EventPublisher`, `.Datacenter string`, `.DefaultCountry string` fields — set once from `main.go`, read by nothing outside this file.

- [ ] **Step 1: Write the failing test**

Create `apps/edge-proxy/internal/proxy/handler_analytics_integration_test.go`:

```go
//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/analytics"
	"rivocloud/edge-proxy/internal/zone"
)

type fakeEventPublisher struct {
	events []analytics.Event
}

func (f *fakeEventPublisher) Publish(event analytics.Event) {
	f.events = append(f.events, event)
}

func TestCachingHandler_PublishesAnalyticsEventOnCacheMiss(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", OrgID: "org1", Host: "demo.test", OriginURL: origin.URL}})
	fake := &fakeEventPublisher{}
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient, Analytics: fake, Datacenter: "test-dc", DefaultCountry: "ZZ"}

	req := httptest.NewRequest("GET", "http://demo.test/hello", nil)
	req.Host = "demo.test"
	req.RemoteAddr = "203.0.113.5:54321"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if len(fake.events) != 1 {
		t.Fatalf("expected exactly 1 published event, got %d", len(fake.events))
	}
	event := fake.events[0]
	if event.ZoneID != "z1" || event.OrgID != "org1" {
		t.Fatalf("unexpected zone/org attribution: %+v", event)
	}
	if event.CacheStatus != "MISS" {
		t.Fatalf("expected CacheStatus MISS, got %q", event.CacheStatus)
	}
	if event.StatusCode != http.StatusOK {
		t.Fatalf("expected StatusCode 200, got %d", event.StatusCode)
	}
	if event.BytesSent != int64(len("hello")) {
		t.Fatalf("expected BytesSent %d, got %d", len("hello"), event.BytesSent)
	}
	if event.Datacenter != "test-dc" {
		t.Fatalf("expected Datacenter test-dc, got %q", event.Datacenter)
	}
	if event.Country != "ZZ" {
		t.Fatalf("expected default Country ZZ, got %q", event.Country)
	}
	if event.ClientIPHash == "" {
		t.Fatal("expected a non-empty client_ip_hash")
	}
}

func TestCachingHandler_UnknownZoneDoesNotPublishAnEvent(t *testing.T) {
	zones := zone.NewStaticRegistry(nil)
	fake := &fakeEventPublisher{}
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient, Analytics: fake}

	req := httptest.NewRequest("GET", "http://unknown.test/anything", nil)
	req.Host = "unknown.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if len(fake.events) != 0 {
		t.Fatalf("expected no published events for an unresolved zone, got %d", len(fake.events))
	}
}

func TestCachingHandler_HonorsXRivoCloudCountryHeader(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	fake := &fakeEventPublisher{}
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient, Analytics: fake, DefaultCountry: "ZZ"}

	req := httptest.NewRequest("GET", "http://demo.test/x", nil)
	req.Host = "demo.test"
	req.Header.Set("X-RivoCloud-Country", "de")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if fake.events[0].Country != "DE" {
		t.Fatalf("expected header-provided country to be upper-cased to DE, got %q", fake.events[0].Country)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/edge-proxy && bash scripts/go-docker.sh go test -tags=integration ./internal/proxy/... -run TestCachingHandler_PublishesAnalyticsEvent -v`
Expected: FAIL — compile error, `CachingHandler` has no field `Analytics`/`Datacenter`/`DefaultCountry`.

- [ ] **Step 3: Instrument `handler.go`**

Add imports to `apps/edge-proxy/internal/proxy/handler.go` (alongside the existing ones):

```go
	"crypto/sha256"
	"encoding/hex"
```

and

```go
	"rivocloud/edge-proxy/internal/analytics"
```

Add fields to the `CachingHandler` struct (after `Now`):

```go
	// Analytics publishes one edge.request event per handled request (EDD
	// Section 2.5). Nil in tests that don't care about analytics.
	Analytics      analytics.EventPublisher
	Datacenter     string
	DefaultCountry string
```

Replace the entire `ServeHTTP` method body with:

```go
func (h *CachingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := h.now()
	rec := newStatusRecorder(w)
	cacheStatus := "BYPASS"
	var resolvedZone zone.Config
	zoneResolved := false
	defer func() {
		if zoneResolved {
			h.recordEvent(r, resolvedZone, rec, cacheStatus, start)
		}
	}()

	z, ok := h.Zones.Resolve(r.Host)
	if !ok {
		http.Error(rec, "unknown zone", http.StatusNotFound)
		return
	}
	resolvedZone = z
	zoneResolved = true

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.proxyUncached(rec, r, z)
		return
	}

	// A Range request bypasses the cache in both directions. The cache key
	// carries no range, so serving a stored full body would answer the wrong
	// bytes and storing a 206 would poison the full-body entry.
	if r.Header.Get("Range") != "" {
		h.proxyUncached(rec, r, z)
		return
	}

	// Normalized once and reused for both rule-matching and the stored
	// Entry.Path: cachekey.Build lowercases the path internally when hashing
	// the cache key, so matching cache rules against the RAW path would let
	// "/API/users" dodge a "/api/*" bypass rule while still sharing a cache
	// key (and now an Entry.Path, which a future purge will glob-match
	// against) with "/api/users" — silently caching a response that should
	// never have been cached, under a key an unrelated case variant can hit.
	normalizedPath := strings.ToLower(r.URL.Path)

	rule, ruleMatched := cacherules.Match(z.Rules, normalizedPath)
	// A bypass/no-store rule (EDD Section 5.3, Priority 1) means "never
	// cache this," which is exactly what the uncached passthrough path
	// already does — no separate non-caching branch needed.
	if ruleMatched && (rule.Action == "bypass" || rule.Action == "no-store") {
		h.proxyUncached(rec, r, z)
		return
	}

	queryMode, queryWhitelist := "include_all", []string(nil)
	if ruleMatched {
		queryMode, queryWhitelist = rule.QueryString, rule.QueryWhitelist
	}
	key := cachekey.Build(z.ID, cachekey.NormalizeMethod(r.Method), r.Host, r.URL.Path, r.URL.RawQuery, queryMode, queryWhitelist)
	now := h.now()

	entry, hitLayerIdx, found := h.lookup(r.Context(), key, now)
	if found && entry.Fresh(now) {
		h.populateFasterLayers(r.Context(), key, entry, hitLayerIdx)
		cacheStatus = "HIT"
		writeEntry(rec, r, h.negotiateEncoding(r, key, entry), now, "HIT")
		return
	}
	cacheStatus = "MISS"

	etag := ""
	if found {
		etag = entry.ETag
	}
	var ruleTTLOverride *time.Duration
	var ruleBrowserTTLOverride *time.Duration
	if ruleMatched && rule.EdgeTTL != nil {
		d := time.Duration(*rule.EdgeTTL) * time.Second
		ruleTTLOverride = &d
	}
	if ruleMatched && rule.BrowserTTL != nil {
		d := time.Duration(*rule.BrowserTTL) * time.Second
		ruleBrowserTTLOverride = &d
	}
	result, err := h.fetchOrigin(r, z, originRequest{
		method:           http.MethodGet,
		ifNoneMatch:      etag,
		ownsRevalidation: true,
		ttlOverride:      ruleTTLOverride,
	})
	if err != nil {
		if found && entry.UsableAsStale(now) {
			cacheStatus = "STALE"
			writeEntry(rec, r, h.negotiateEncoding(r, key, entry), now, "STALE")
			return
		}
		http.Error(rec, "origin unreachable", http.StatusBadGateway)
		return
	}

	if result.notModified {
		if !found {
			// Unreachable once the client's own conditional headers are
			// stripped above: the edge only sends If-None-Match when it has
			// something to revalidate. Refreshing/serving the zero-valued
			// entry here would emit WriteHeader(0) and panic, so fail loudly
			// instead.
			log.Printf("origin returned 304 with nothing cached for key %s", key)
			http.Error(rec, "unexpected origin 304", http.StatusBadGateway)
			return
		}
		refreshed := refreshExpiry(entry, result.decision, now)
		refreshed.BrowserTTL = ruleBrowserTTLOverride
		if result.decision.Cacheable {
			h.store(r.Context(), key, refreshed)
		}
		cacheStatus = "HIT"
		writeEntry(rec, r, h.negotiateEncoding(r, key, refreshed), now, "HIT")
		return
	}

	defer result.response.Body.Close()
	body, err := io.ReadAll(result.response.Body)
	if err != nil {
		http.Error(rec, "error reading origin response", http.StatusBadGateway)
		return
	}
	newEntry := buildEntry(result.response, body, result.decision, now, z.ID, normalizedPath)
	newEntry.BrowserTTL = ruleBrowserTTLOverride
	if result.decision.Cacheable {
		h.store(r.Context(), key, newEntry)
	}
	writeEntry(rec, r, h.negotiateEncoding(r, key, newEntry), now, "MISS")
}
```

(`proxyUncached` itself is unchanged — it already accepts any `http.ResponseWriter`, and `rec` satisfies that interface.)

Add these new types/functions near the bottom of the file (before `negotiateEncoding` is fine):

```go
// statusRecorder wraps http.ResponseWriter to capture the status code and
// byte count actually sent to the client — neither is otherwise recorded
// anywhere on the hot path, and both are needed for analytics events.
type statusRecorder struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int64
}

func newStatusRecorder(w http.ResponseWriter) *statusRecorder {
	return &statusRecorder{ResponseWriter: w, statusCode: http.StatusOK}
}

func (rec *statusRecorder) WriteHeader(code int) {
	rec.statusCode = code
	rec.ResponseWriter.WriteHeader(code)
}

func (rec *statusRecorder) Write(b []byte) (int, error) {
	n, err := rec.ResponseWriter.Write(b)
	rec.bytesWritten += int64(n)
	return n, err
}

// recordEvent publishes one edge.request analytics event (EDD Section 2.5).
// h.Analytics is nil in every test that doesn't care about analytics, and
// Publisher.Publish itself degrades to a no-op whenever NATS is unavailable.
func (h *CachingHandler) recordEvent(r *http.Request, z zone.Config, rec *statusRecorder, cacheStatus string, start time.Time) {
	if h.Analytics == nil {
		return
	}
	h.Analytics.Publish(analytics.Event{
		Timestamp:    start,
		ZoneID:       z.ID,
		OrgID:        z.OrgID,
		Datacenter:   h.Datacenter,
		Method:       r.Method,
		Path:         r.URL.Path,
		StatusCode:   rec.statusCode,
		CacheStatus:  cacheStatus,
		BytesSent:    rec.bytesWritten,
		DurationMs:   time.Since(start).Milliseconds(),
		Country:      requestCountry(r, h.DefaultCountry),
		ClientIPHash: hashClientIP(r.RemoteAddr),
	})
}

// requestCountry reads an optional X-RivoCloud-Country header — the seam a
// future GeoDNS/load-balancer layer (or a test) sets — falling back to the
// proxy's configured default. Phase 1 has no GeoIP database wired up
// anywhere in this codebase (no distributed edge yet — PRD Stage 12), so
// this header is the accepted placeholder source of truth for the "country"
// analytics dimension until a real GeoDNS layer sets it instead.
func requestCountry(r *http.Request, fallback string) string {
	if c := r.Header.Get("X-RivoCloud-Country"); c != "" {
		return strings.ToUpper(c)
	}
	if fallback != "" {
		return fallback
	}
	return "ZZ"
}

// hashClientIP SHA-256 hashes the client's IP so analytics never stores a
// real visitor's address (EDD Section 2.5's client_ip_hash field).
func hashClientIP(remoteAddr string) string {
	ip, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		ip = remoteAddr
	}
	sum := sha256.Sum256([]byte(ip))
	return hex.EncodeToString(sum[:])
}
```

- [ ] **Step 4: Wire it into `main.go`**

In `apps/edge-proxy/cmd/edge-proxy/main.go`, add the import `"rivocloud/edge-proxy/internal/analytics"`, then update the handler construction and add a helper:

```go
	analyticsPublisher, _ := analytics.Connect(natsURL())

	handler := &proxy.CachingHandler{
		Zones:          zones,
		Layers:         layers,
		Origin:         newOriginClient(),
		Analytics:      analyticsPublisher,
		Datacenter:     datacenter(),
		DefaultCountry: defaultCountry(),
	}
```

```go
func defaultCountry() string {
	if c := os.Getenv("EDGE_DEFAULT_COUNTRY"); c != "" {
		return c
	}
	return "ZZ"
}
```

- [ ] **Step 5: Run all edge-proxy tests to verify nothing regressed**

Run: `cd apps/edge-proxy && bash scripts/go-docker.sh go test -tags=integration ./... -v` and `bash scripts/go-docker.sh go test ./... -v`
Expected: PASS across every package (existing tests never set `Analytics`, so `h.Analytics == nil` keeps them all unaffected).

- [ ] **Step 6: Add `EDGE_DEFAULT_COUNTRY` to `.env.example`**

In the `# Edge Proxy` section of `.env.example`, add:

```
EDGE_DEFAULT_COUNTRY=ZZ
```

- [ ] **Step 7: Commit**

```bash
git add apps/edge-proxy/internal/proxy/ apps/edge-proxy/cmd/edge-proxy/main.go .env.example
git commit -m "feat(edge-proxy): publish edge.request analytics events on every request"
```

---

### Task 4: Infra — ClickHouse healthcheck, CI service, turbo env allowlist

**Files:**
- Modify: `infrastructure/compose/docker-compose.infra.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `turbo.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: a `CLICKHOUSE_URL` env var reliably available in local dev, CI, and every later NestJS task's integration tests.

- [ ] **Step 1: Add a healthcheck to the `clickhouse` compose service**

In `infrastructure/compose/docker-compose.infra.yml`, update the `clickhouse` service:

```yaml
  clickhouse:
    image: clickhouse/clickhouse-server:23
    ports:
      - "8123:8123"
      - "9009:9000"
    volumes:
      - clickhouse_data:/var/lib/clickhouse
    healthcheck:
      test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [rivocloud]
```

- [ ] **Step 2: Verify ClickHouse comes up healthy locally**

Run: `docker compose -f infrastructure/compose/docker-compose.infra.yml up -d clickhouse` then `docker compose -f infrastructure/compose/docker-compose.infra.yml ps clickhouse`
Expected: status shows `healthy` within ~10-15s. Also verify `curl http://localhost:8123/ping` returns `Ok.`.

- [ ] **Step 3: Add ClickHouse to CI's `test-integration` job**

In `.github/workflows/ci.yml`, add a `clickhouse` entry alongside `postgres`/`redis`/`nats` under `test-integration`'s `services:`:

```yaml
      clickhouse:
        image: clickhouse/clickhouse-server:23
        ports:
          - 8123:8123
        options: >-
          --health-cmd "clickhouse-client --query 'SELECT 1'"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
```

and add to the job's `env:` block:

```yaml
      CLICKHOUSE_URL: http://localhost:8123
```

- [ ] **Step 4: Add `CLICKHOUSE_URL` to turbo's `test:integration` env allowlist**

In `turbo.json`, add `"CLICKHOUSE_URL"` to the `test:integration` task's `env` array (alongside the existing entries).

- [ ] **Step 5: Add an Analytics Service section to `.env.example`**

Add, after the existing `# Scheduler` section:

```
# Analytics Service
ANALYTICS_SERVICE_PORT=3006
ANALYTICS_SERVICE_URL=http://localhost:3006
```

and append `ANALYTICS_SERVICE_URL=http://localhost:3006` to the existing `# Dashboard` section.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/compose/docker-compose.infra.yml .github/workflows/ci.yml turbo.json .env.example
git commit -m "chore(infra): wire ClickHouse healthcheck and CI service for Stage 9"
```

---

### Task 5: Scaffold `apps/analytics-service` (health check only)

**Files:**
- Create: `apps/analytics-service/package.json`, `tsconfig.json`, `.swcrc`, `vitest.config.ts`, `vitest.integration.config.ts`
- Create: `apps/analytics-service/src/main.ts`, `app.module.ts`, `app-env.token.ts`, `env.ts`, `env.module.ts`
- Create: `apps/analytics-service/src/prisma/prisma.module.ts`
- Create: `apps/analytics-service/src/health/health.controller.ts`
- Test: `apps/analytics-service/src/health/health.controller.integration.test.ts`

**Interfaces:**
- Consumes: `@rivocloud/config`'s `baseEnvSchema`/`validateEnv`, `@rivocloud/db`'s `prisma` singleton.
- Produces: a bootable NestJS service on `env.PORT` (default 3006) with `GET /api/v1/health → { status: 'ok' }`; `APP_ENV` DI token; `PRISMA` DI token — consumed by every later analytics-service task.

- [ ] **Step 1: Create the package scaffold**

`apps/analytics-service/package.json` (mirrors `apps/scheduler/package.json` exactly, minus `@nestjs/schedule`, plus the ClickHouse client and `nats`):

```json
{
  "name": "@rivocloud/analytics-service",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@clickhouse/client": "^1.9.1",
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@rivocloud/config": "workspace:*",
    "@rivocloud/db": "workspace:*",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "nats": "^2.28.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.4",
    "@swc/core": "^1.15.46",
    "@types/express": "^4.17.21",
    "@types/node": "^20.16.11",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "unplugin-swc": "^1.5.9",
    "vitest": "^2.1.1"
  }
}
```

`apps/analytics-service/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src"]
}
```

`apps/analytics-service/.swcrc` (identical to `apps/scheduler/.swcrc`):

```json
{
  "jsc": {
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },
    "target": "es2022",
    "keepClassNames": true
  },
  "module": { "type": "es6" },
  "sourceMaps": true
}
```

`apps/analytics-service/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    passWithNoTests: true,
  },
});
```

`apps/analytics-service/vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 2: Write `env.ts`, `env.module.ts`, `app-env.token.ts`**

`apps/analytics-service/src/env.ts`:

```ts
import { z } from 'zod';
import { baseEnvSchema, validateEnv } from '@rivocloud/config';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3006),
  IDENTITY_SERVICE_URL: z.string().url(),
  INTERNAL_API_SECRET: z.string().min(16),
  CLICKHOUSE_URL: z.string().url(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return validateEnv(envSchema, env);
}
```

`apps/analytics-service/src/app-env.token.ts`:

```ts
export const APP_ENV = 'APP_ENV';
```

`apps/analytics-service/src/env.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { APP_ENV } from './app-env.token.js';
import { loadEnv } from './env.js';

@Global()
@Module({
  providers: [{ provide: APP_ENV, useValue: loadEnv() }],
  exports: [APP_ENV],
})
export class EnvModule {}
```

- [ ] **Step 3: Write the Prisma module, health controller, and its test**

`apps/analytics-service/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { prisma } from '@rivocloud/db';

export const PRISMA = 'PRISMA';

@Global()
@Module({
  providers: [{ provide: PRISMA, useValue: prisma }],
  exports: [PRISMA],
})
export class PrismaModule {}
```

`apps/analytics-service/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('api/v1/health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

`apps/analytics-service/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EnvModule } from './env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [EnvModule, PrismaModule],
  controllers: [HealthController],
})
export class AppModule {}
```

`apps/analytics-service/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadEnv } from './env.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(env.PORT);
  console.log(`analytics-service listening on :${env.PORT}`);
}

bootstrap();
```

`apps/analytics-service/src/health/health.controller.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module.js';

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 4: Install dependencies and run the test**

Run: `pnpm install` (from repo root, to register the new workspace package), then, with Postgres running (`docker compose -f infrastructure/compose/docker-compose.infra.yml up -d postgres`) and `DATABASE_URL`/`NATS_URL`/`CLICKHOUSE_URL`/`IDENTITY_SERVICE_URL`/`INTERNAL_API_SECRET` set (source `.env.example`'s values or your `.env`): `pnpm --filter @rivocloud/analytics-service test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/analytics-service/ pnpm-lock.yaml
git commit -m "feat(analytics-service): scaffold NestJS service with health check"
```

---

### Task 6: `analytics-service` — ClickHouse client module and schema application

**Files:**
- Create: `apps/analytics-service/src/clickhouse/clickhouse.token.ts`
- Create: `apps/analytics-service/src/clickhouse/schema.ts`
- Create: `apps/analytics-service/src/clickhouse/schema.service.ts`
- Create: `apps/analytics-service/src/clickhouse/clickhouse.module.ts`
- Test: `apps/analytics-service/src/clickhouse/schema.service.integration.test.ts`
- Modify: `apps/analytics-service/src/app.module.ts`

**Interfaces:**
- Consumes: `APP_ENV` (Task 5).
- Produces: `CLICKHOUSE` DI token (a `@clickhouse/client` `ClickHouseClient`), and the three tables (`request_logs`, `bandwidth_hourly`, `requests_by_country_daily`) guaranteed to exist once `ClickhouseModule` is imported — consumed by every later analytics-service and scheduler task.

- [ ] **Step 1: Write the schema statements**

`apps/analytics-service/src/clickhouse/schema.ts`:

```ts
// EDD Section 6.6 — exact table definitions. Duplicated (not imported) into
// apps/scheduler/src/clickhouse/schema.ts per this plan's Design Decision 4.
export const REQUEST_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS request_logs (
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
TTL toDateTime(timestamp) + INTERVAL 90 DAY
`;

export const BANDWIDTH_HOURLY_TABLE = `
CREATE TABLE IF NOT EXISTS bandwidth_hourly (
  hour            DateTime,
  zone_id         String,
  org_id          String,
  bytes_sent      UInt64,
  requests        UInt64,
  cache_hits      UInt64,
  cache_misses    UInt64
)
ENGINE = SummingMergeTree()
ORDER BY (zone_id, hour)
`;

export const REQUESTS_BY_COUNTRY_DAILY_TABLE = `
CREATE TABLE IF NOT EXISTS requests_by_country_daily (
  date            Date,
  zone_id         String,
  country         FixedString(2),
  requests        UInt64,
  bytes_sent      UInt64
)
ENGINE = SummingMergeTree()
ORDER BY (zone_id, date, country)
`;

export const SCHEMA_STATEMENTS = [REQUEST_LOGS_TABLE, BANDWIDTH_HOURLY_TABLE, REQUESTS_BY_COUNTRY_DAILY_TABLE];
```

- [ ] **Step 2: Write the ClickHouse token, module, and schema service**

`apps/analytics-service/src/clickhouse/clickhouse.token.ts`:

```ts
export const CLICKHOUSE = 'CLICKHOUSE';
```

`apps/analytics-service/src/clickhouse/schema.service.ts`:

```ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { CLICKHOUSE } from './clickhouse.token.js';
import { SCHEMA_STATEMENTS } from './schema.js';

@Injectable()
export class SchemaService implements OnModuleInit {
  private readonly logger = new Logger(SchemaService.name);

  constructor(@Inject(CLICKHOUSE) private readonly client: ClickHouseClient) {}

  async onModuleInit(): Promise<void> {
    for (const statement of SCHEMA_STATEMENTS) {
      await this.client.command({ query: statement });
    }
    this.logger.log('ClickHouse schema is up to date');
  }
}
```

`apps/analytics-service/src/clickhouse/clickhouse.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { createClient } from '@clickhouse/client';
import { CLICKHOUSE } from './clickhouse.token.js';
import { SchemaService } from './schema.service.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Global()
@Module({
  providers: [
    {
      provide: CLICKHOUSE,
      useFactory: (env: AppEnv) => createClient({ url: env.CLICKHOUSE_URL }),
      inject: [APP_ENV],
    },
    SchemaService,
  ],
  exports: [CLICKHOUSE],
})
export class ClickhouseModule {}
```

Update `apps/analytics-service/src/app.module.ts` to import it:

```ts
import { ClickhouseModule } from './clickhouse/clickhouse.module.js';
// ...
@Module({
  imports: [EnvModule, PrismaModule, ClickhouseModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 3: Write the integration test**

`apps/analytics-service/src/clickhouse/schema.service.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';

describe('SchemaService', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates all three tables on boot', async () => {
    const client = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
    for (const table of ['request_logs', 'bandwidth_hourly', 'requests_by_country_daily']) {
      const resultSet = await client.query({ query: `EXISTS TABLE ${table}`, format: 'JSONEachRow' });
      const [row] = await resultSet.json<{ result: number }>();
      expect(row.result).toBe(1);
    }
    await client.close();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @rivocloud/analytics-service test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/analytics-service/src/clickhouse/ apps/analytics-service/src/app.module.ts
git commit -m "feat(analytics-service): add ClickHouse client and idempotent schema application"
```

---

### Task 7: `analytics-service` — auth module (duplicated from `cdn-service`)

**Files:**
- Create: `apps/analytics-service/src/auth/auth-context.decorator.ts`
- Create: `apps/analytics-service/src/auth/identity-client.ts`
- Create: `apps/analytics-service/src/auth/identity-client.test.ts`
- Create: `apps/analytics-service/src/auth/identity-client.provider.ts`
- Create: `apps/analytics-service/src/auth/auth-guard.ts`
- Create: `apps/analytics-service/src/auth/auth-guard.test.ts`
- Create: `apps/analytics-service/src/auth/analytics-access.guard.ts`
- Create: `apps/analytics-service/src/auth/analytics-access.guard.test.ts`
- Create: `apps/analytics-service/src/auth/auth.module.ts`
- Modify: `apps/analytics-service/src/app.module.ts`

**Interfaces:**
- Produces: `AuthGuard`, `AnalyticsAccessGuard`, `AuthCtx` decorator, `CombinedAuthContext` type, `IdentityClient` — consumed by Task 10's `AnalyticsController`.

- [ ] **Step 1: Copy the context decorator and IdentityClient verbatim**

`apps/analytics-service/src/auth/auth-context.decorator.ts` (identical to `apps/cdn-service/src/auth/auth-context.decorator.ts`):

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CombinedAuthContext {
  type: 'jwt' | 'api_key';
  userId: string | null;
  orgId: string | null;
  role: string | null;
  apiKeyId?: string;
  permissions?: string[];
}

export const AuthCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): CombinedAuthContext => {
  const request = ctx.switchToHttp().getRequest();
  return request.auth;
});
```

`apps/analytics-service/src/auth/identity-client.ts` (identical to `apps/cdn-service/src/auth/identity-client.ts`):

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CombinedAuthContext } from './auth-context.decorator.js';

interface IdentityResponseBody {
  userId: string;
  orgId: string;
  role?: string;
  permissions?: string[];
}

@Injectable()
export class IdentityClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async verifyToken(token: string): Promise<CombinedAuthContext> {
    const body = await this.post('/internal/auth/verify-token', { token }, 'Invalid or expired token');
    return { type: 'jwt', userId: body.userId, orgId: body.orgId, role: body.role ?? null };
  }

  async verifyApiKey(apiKey: string): Promise<CombinedAuthContext> {
    const body = await this.post('/internal/auth/verify-api-key', { apiKey }, 'Invalid API key');
    return { type: 'api_key', userId: body.userId, orgId: body.orgId, role: null, permissions: body.permissions };
  }

  private async post(path: string, payload: unknown, failureMessage: string): Promise<IdentityResponseBody> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': this.internalSecret },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new UnauthorizedException('Identity Service unreachable');
    }
    if (!response.ok) {
      throw new UnauthorizedException(failureMessage);
    }
    return (await response.json()) as IdentityResponseBody;
  }
}
```

`apps/analytics-service/src/auth/identity-client.test.ts` (identical structure to `apps/cdn-service/src/auth/identity-client.test.ts` — write it by exercising `verifyToken`/`verifyApiKey` against a stubbed global `fetch`):

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { IdentityClient } from './identity-client.js';

describe('IdentityClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifyToken returns a jwt auth context on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: 'u1', orgId: 'o1', role: 'owner' }), { status: 200 })),
    );
    const client = new IdentityClient('http://identity', 'secret');
    const auth = await client.verifyToken('tok');
    expect(auth).toEqual({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'owner' });
  });

  it('verifyToken throws UnauthorizedException on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const client = new IdentityClient('http://identity', 'secret');
    await expect(client.verifyToken('bad')).rejects.toThrow('Invalid or expired token');
  });

  it('verifyApiKey returns an api_key auth context on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: 'u1', orgId: 'o1', permissions: ['zone:read'] }), { status: 200 })),
    );
    const client = new IdentityClient('http://identity', 'secret');
    const auth = await client.verifyApiKey('rc_key');
    expect(auth).toEqual({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, permissions: ['zone:read'] });
  });

  it('throws UnauthorizedException when the Identity Service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const client = new IdentityClient('http://identity', 'secret');
    await expect(client.verifyToken('tok')).rejects.toThrow('Identity Service unreachable');
  });
});
```

`apps/analytics-service/src/auth/identity-client.provider.ts`:

```ts
import { Provider } from '@nestjs/common';
import { IdentityClient } from './identity-client.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const identityClientProvider: Provider = {
  provide: IdentityClient,
  useFactory: (env: AppEnv) => new IdentityClient(env.IDENTITY_SERVICE_URL, env.INTERNAL_API_SECRET),
  inject: [APP_ENV],
};
```

`apps/analytics-service/src/auth/auth-guard.ts` (identical to `apps/cdn-service/src/auth/auth-guard.ts`):

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { IdentityClient } from './identity-client.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly identity: IdentityClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
    const authHeader = request.headers['authorization'] as string | undefined;

    if (apiKeyHeader?.startsWith('rc_')) {
      request.auth = await this.identity.verifyApiKey(apiKeyHeader);
      return true;
    }

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization bearer token or X-API-Key header');
    }
    request.auth = await this.identity.verifyToken(authHeader.slice('Bearer '.length));
    return true;
  }
}
```

`apps/analytics-service/src/auth/auth-guard.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth-guard.js';
import type { IdentityClient } from './identity-client.js';

function makeContext(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; auth?: unknown } = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext & { request: typeof request };
}

describe('AuthGuard', () => {
  it('resolves via API key when X-API-Key starts with rc_', async () => {
    const verifyApiKey = vi.fn().mockResolvedValue({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null });
    const guard = new AuthGuard({ verifyApiKey } as unknown as IdentityClient);
    const context = makeContext({ 'x-api-key': 'rc_live_abc' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyApiKey).toHaveBeenCalledWith('rc_live_abc');
  });

  it('resolves via bearer token when no X-API-Key is present', async () => {
    const verifyToken = vi.fn().mockResolvedValue({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'owner' });
    const guard = new AuthGuard({ verifyToken } as unknown as IdentityClient);
    const context = makeContext({ authorization: 'Bearer tok123' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('tok123');
  });

  it('throws when neither header is present', async () => {
    const guard = new AuthGuard({} as unknown as IdentityClient);
    const context = makeContext({});
    await expect(guard.canActivate(context)).rejects.toThrow('Missing Authorization bearer token or X-API-Key header');
  });
});
```

- [ ] **Step 2: Write the analytics-specific access guard (a trimmed `ZoneScopeGuard`)**

`apps/analytics-service/src/auth/analytics-access.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { CombinedAuthContext } from './auth-context.decorator.js';

// Every analytics endpoint is read-only, so unlike cdn-service's
// ZoneScopeGuard (which varies by action), this guard only ever checks the
// read-equivalent permission/role — mirroring
// apps/cdn-service/src/auth/zone-scope.guard.ts's 'read' case exactly.
const READ_ALLOWED_ROLES = ['owner', 'admin', 'developer', 'viewer'];

@Injectable()
export class AnalyticsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const auth: CombinedAuthContext = request.auth;

    if (auth.type === 'api_key') {
      if (!auth.permissions?.includes('zone:read')) {
        throw new ForbiddenException('API key is missing the "zone:read" scope');
      }
      return true;
    }

    if (!auth.role || !READ_ALLOWED_ROLES.includes(auth.role)) {
      throw new ForbiddenException(`Requires one of roles: ${READ_ALLOWED_ROLES.join(', ')}`);
    }
    return true;
  }
}
```

`apps/analytics-service/src/auth/analytics-access.guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { AnalyticsAccessGuard } from './analytics-access.guard.js';
import type { CombinedAuthContext } from './auth-context.decorator.js';

function makeContext(auth: CombinedAuthContext): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
}

describe('AnalyticsAccessGuard', () => {
  const guard = new AnalyticsAccessGuard();

  it('allows an api_key with zone:read', () => {
    const context = makeContext({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, permissions: ['zone:read'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects an api_key missing zone:read', () => {
    const context = makeContext({ type: 'api_key', userId: 'u1', orgId: 'o1', role: null, permissions: [] });
    expect(() => guard.canActivate(context)).toThrow('API key is missing the "zone:read" scope');
  });

  it('allows a jwt with a viewer role', () => {
    const context = makeContext({ type: 'jwt', userId: 'u1', orgId: 'o1', role: 'viewer' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a jwt with no role', () => {
    const context = makeContext({ type: 'jwt', userId: 'u1', orgId: 'o1', role: null });
    expect(() => guard.canActivate(context)).toThrow(/Requires one of roles/);
  });
});
```

- [ ] **Step 3: Write the auth module and wire it into `AppModule`**

`apps/analytics-service/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { identityClientProvider } from './identity-client.provider.js';
import { IdentityClient } from './identity-client.js';
import { AuthGuard } from './auth-guard.js';
import { AnalyticsAccessGuard } from './analytics-access.guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard, AnalyticsAccessGuard],
  exports: [IdentityClient, AuthGuard, AnalyticsAccessGuard],
})
export class AuthModule {}
```

Update `apps/analytics-service/src/app.module.ts`'s `imports` to include `AuthModule`.

- [ ] **Step 4: Run the unit tests**

Run: `pnpm --filter @rivocloud/analytics-service test:unit`
Expected: PASS (11 tests across the four new test files).

- [ ] **Step 5: Commit**

```bash
git add apps/analytics-service/src/auth/ apps/analytics-service/src/app.module.ts
git commit -m "feat(analytics-service): add auth module (JWT/API-key guard + read-only access check)"
```

---

### Task 8: `analytics-service` — NATS ingestion (buffer + bulk insert into `request_logs`)

**Files:**
- Create: `apps/analytics-service/src/ingestion/edge-request-event.ts`
- Create: `apps/analytics-service/src/ingestion/parse-event.ts`
- Create: `apps/analytics-service/src/ingestion/parse-event.test.ts`
- Create: `apps/analytics-service/src/ingestion/request-log-writer.ts`
- Create: `apps/analytics-service/src/ingestion/request-log-writer.integration.test.ts`
- Create: `apps/analytics-service/src/ingestion/ingestion.service.ts`
- Create: `apps/analytics-service/src/ingestion/ingestion.service.test.ts`
- Create: `apps/analytics-service/src/ingestion/ingestion.service.integration.test.ts`
- Create: `apps/analytics-service/src/ingestion/ingestion.module.ts`
- Modify: `apps/analytics-service/src/app.module.ts`

**Interfaces:**
- Consumes: `CLICKHOUSE` token (Task 6).
- Produces: `EdgeRequestEvent` type, `RequestLogWriter.insertBatch(events)` — consumed by Task 9's internal endpoint.

- [ ] **Step 1: Write the event schema and pure parser**

`apps/analytics-service/src/ingestion/edge-request-event.ts`:

```ts
import { z } from 'zod';

// Mirrors apps/edge-proxy/internal/analytics/event.go's Event struct exactly
// — this JSON shape is the cross-service contract (EDD Section 2.5).
export const edgeRequestEventSchema = z.object({
  timestamp: z.string(),
  zone_id: z.string(),
  org_id: z.string(),
  datacenter: z.string(),
  method: z.string(),
  path: z.string(),
  status_code: z.number().int(),
  cache_status: z.string(),
  bytes_sent: z.number().int(),
  duration_ms: z.number().int(),
  country: z.string(),
  client_ip_hash: z.string(),
});

export type EdgeRequestEvent = z.infer<typeof edgeRequestEventSchema>;
```

`apps/analytics-service/src/ingestion/parse-event.ts`:

```ts
import { edgeRequestEventSchema, type EdgeRequestEvent } from './edge-request-event.js';

export function parseEdgeRequestEvent(data: Uint8Array): EdgeRequestEvent | null {
  try {
    return edgeRequestEventSchema.parse(JSON.parse(new TextDecoder().decode(data)));
  } catch {
    return null;
  }
}
```

`apps/analytics-service/src/ingestion/parse-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEdgeRequestEvent } from './parse-event.js';

const VALID_PAYLOAD = {
  timestamp: '2026-06-29T10:00:00Z', zone_id: 'z1', org_id: 'o1', datacenter: 'dc1',
  method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
  bytes_sent: 100, duration_ms: 5, country: 'DE', client_ip_hash: 'abc',
};

describe('parseEdgeRequestEvent', () => {
  it('parses a valid edge.request payload', () => {
    const event = parseEdgeRequestEvent(new TextEncoder().encode(JSON.stringify(VALID_PAYLOAD)));
    expect(event).toEqual(VALID_PAYLOAD);
  });

  it('returns null for malformed JSON', () => {
    expect(parseEdgeRequestEvent(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    expect(parseEdgeRequestEvent(new TextEncoder().encode(JSON.stringify({ zone_id: 'z1' })))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the parser test**

Run: `pnpm --filter @rivocloud/analytics-service test:unit`
Expected: PASS (3 new tests).

- [ ] **Step 3: Write `RequestLogWriter` and its integration test**

`apps/analytics-service/src/ingestion/request-log-writer.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { CLICKHOUSE } from '../clickhouse/clickhouse.token.js';
import type { EdgeRequestEvent } from './edge-request-event.js';

@Injectable()
export class RequestLogWriter {
  constructor(@Inject(CLICKHOUSE) private readonly client: ClickHouseClient) {}

  async insertBatch(events: EdgeRequestEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.client.insert({
      table: 'request_logs',
      values: events,
      format: 'JSONEachRow',
    });
  }
}
```

`apps/analytics-service/src/ingestion/request-log-writer.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';
import { RequestLogWriter } from './request-log-writer.js';

describe('RequestLogWriter', () => {
  let app: INestApplication;
  let writer: RequestLogWriter;
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    writer = app.get(RequestLogWriter);
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await ch.close();
    await app.close();
  });

  it('inserts a batch of events into request_logs', async () => {
    const zoneId = `test-zone-${Date.now()}`;
    await writer.insertBatch([
      {
        timestamp: '2026-06-29T10:00:00.000Z', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1',
        method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
        bytes_sent: 1234, duration_ms: 7, country: 'DE', client_ip_hash: 'hash1',
      },
    ]);

    const resultSet = await ch.query({
      query: 'SELECT * FROM request_logs WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ zone_id: string; bytes_sent: string }>();
    expect(rows).toHaveLength(1);
    expect(rows[0].zone_id).toBe(zoneId);
    expect(Number(rows[0].bytes_sent)).toBe(1234);
  });

  it('is a no-op for an empty batch', async () => {
    await expect(writer.insertBatch([])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the integration test**

Run (ClickHouse must be up): `pnpm --filter @rivocloud/analytics-service test:integration`
Expected: PASS.

- [ ] **Step 5: Write `IngestionService` and its unit test**

`apps/analytics-service/src/ingestion/ingestion.service.ts`:

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, type NatsConnection, type Subscription } from 'nats';
import { parseEdgeRequestEvent } from './parse-event.js';
import type { EdgeRequestEvent } from './edge-request-event.js';
import { RequestLogWriter } from './request-log-writer.js';

// EDD Section 2.5: flush at 1,000 buffered events or 5 seconds, whichever
// first — fixed constants, not configurable (this plan's Global Constraints).
const FLUSH_BATCH_SIZE = 1000;
const FLUSH_INTERVAL_MS = 5000;

@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private buffer: EdgeRequestEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private connection: NatsConnection | null = null;
  private subscription: Subscription | null = null;

  constructor(
    private readonly natsUrl: string,
    private readonly writer: RequestLogWriter,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.connection = await connect({ servers: this.natsUrl });
    } catch (error) {
      this.logger.warn(`NATS unavailable, edge.request events will not be ingested: ${(error as Error).message}`);
      return;
    }
    this.subscription = this.connection.subscribe('edge.request');
    void this.consume(this.subscription);
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  private async consume(subscription: Subscription): Promise<void> {
    for await (const msg of subscription) {
      const event = parseEdgeRequestEvent(msg.data);
      if (!event) {
        this.logger.warn('dropping malformed edge.request event');
        continue;
      }
      this.enqueue(event);
    }
  }

  enqueue(event: EdgeRequestEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.writer.insertBatch(batch);
    } catch (error) {
      this.logger.error(`failed to flush ${batch.length} request_logs rows: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
    this.subscription?.unsubscribe();
    await this.connection?.close();
  }
}
```

`apps/analytics-service/src/ingestion/ingestion.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { IngestionService } from './ingestion.service.js';
import type { RequestLogWriter } from './request-log-writer.js';

function makeEvent() {
  return {
    timestamp: '2026-06-29T10:00:00Z', zone_id: 'z1', org_id: 'o1', datacenter: 'dc1',
    method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
    bytes_sent: 100, duration_ms: 5, country: 'DE', client_ip_hash: 'abc',
  };
}

describe('IngestionService', () => {
  it('flushes once the buffer reaches 1000 events', () => {
    const insertBatch = vi.fn().mockResolvedValue(undefined);
    const service = new IngestionService('nats://unused', { insertBatch } as unknown as RequestLogWriter);
    for (let i = 0; i < 999; i++) service.enqueue(makeEvent());
    expect(insertBatch).not.toHaveBeenCalled();
    service.enqueue(makeEvent());
    expect(insertBatch).toHaveBeenCalledOnce();
    expect(insertBatch.mock.calls[0][0]).toHaveLength(1000);
  });

  it('flush() is a no-op with an empty buffer', async () => {
    const insertBatch = vi.fn();
    const service = new IngestionService('nats://unused', { insertBatch } as unknown as RequestLogWriter);
    await service.flush();
    expect(insertBatch).not.toHaveBeenCalled();
  });

  it('a failed insertBatch does not throw out of flush', async () => {
    const insertBatch = vi.fn().mockRejectedValue(new Error('clickhouse down'));
    const service = new IngestionService('nats://unused', { insertBatch } as unknown as RequestLogWriter);
    service.enqueue(makeEvent());
    await expect(service.flush()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Write the ingestion module and wire it into `AppModule`**

`apps/analytics-service/src/ingestion/ingestion.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { RequestLogWriter } from './request-log-writer.js';
import { IngestionService } from './ingestion.service.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Global()
@Module({
  providers: [
    RequestLogWriter,
    {
      provide: IngestionService,
      useFactory: (env: AppEnv, writer: RequestLogWriter) => new IngestionService(env.NATS_URL, writer),
      inject: [APP_ENV, RequestLogWriter],
    },
  ],
  exports: [IngestionService, RequestLogWriter],
})
export class IngestionModule {}
```

Update `apps/analytics-service/src/app.module.ts`'s `imports` to include `IngestionModule`.

- [ ] **Step 7: Write the end-to-end integration test (real NATS)**

`apps/analytics-service/src/ingestion/ingestion.service.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { connect, type NatsConnection } from 'nats';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';
import { IngestionService } from './ingestion.service.js';

describe('IngestionService (NATS -> ClickHouse)', () => {
  let app: INestApplication;
  let nc: NatsConnection;
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' });
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await nc.close();
    await ch.close();
    await app.close();
  });

  it('ingests a published edge.request event and flushes it on demand', async () => {
    const zoneId = `ingest-test-${Date.now()}`;
    const payload = {
      timestamp: '2026-06-29T10:00:00.000Z', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1',
      method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
      bytes_sent: 500, duration_ms: 3, country: 'FR', client_ip_hash: 'hash2',
    };
    nc.publish('edge.request', new TextEncoder().encode(JSON.stringify(payload)));

    // Give the subscription's async iterator a tick to receive the message,
    // then force a flush rather than waiting the full 5s interval.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await app.get(IngestionService).flush();

    const resultSet = await ch.query({
      query: 'SELECT zone_id FROM request_logs WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    expect(await resultSet.json()).toHaveLength(1);
  });
});
```

- [ ] **Step 8: Run all analytics-service tests**

Run: `pnpm --filter @rivocloud/analytics-service test:unit && pnpm --filter @rivocloud/analytics-service test:integration`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/analytics-service/src/ingestion/ apps/analytics-service/src/app.module.ts
git commit -m "feat(analytics-service): ingest edge.request events from NATS into request_logs"
```

---

### Task 9: `analytics-service` — internal batch-ingest endpoint

**Files:**
- Create: `apps/analytics-service/src/ingestion/internal-auth.guard.ts`
- Create: `apps/analytics-service/src/ingestion/events-internal.dto.ts`
- Create: `apps/analytics-service/src/ingestion/events-internal.controller.ts`
- Create: `apps/analytics-service/src/ingestion/events-internal.controller.integration.test.ts`
- Create: `apps/analytics-service/src/ingestion/ingestion-internal.module.ts`
- Modify: `apps/analytics-service/src/app.module.ts`

**Interfaces:**
- Consumes: `RequestLogWriter` (Task 8).
- Produces: `POST /internal/analytics/events` (EDD Section 7.9).

- [ ] **Step 1: Write the internal auth guard**

`apps/analytics-service/src/ingestion/internal-auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = request.headers['x-internal-secret'];
    if (secret !== this.env.INTERNAL_API_SECRET) {
      throw new UnauthorizedException('Invalid or missing X-Internal-Secret');
    }
    return true;
  }
}
```

- [ ] **Step 2: Write the DTO and controller**

`apps/analytics-service/src/ingestion/events-internal.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsString, ValidateNested } from 'class-validator';

export class IngestEventDto {
  @IsISO8601() timestamp!: string;
  @IsString() zone_id!: string;
  @IsString() org_id!: string;
  @IsString() datacenter!: string;
  @IsString() method!: string;
  @IsString() path!: string;
  @IsInt() status_code!: number;
  @IsString() cache_status!: string;
  @IsInt() bytes_sent!: number;
  @IsInt() duration_ms!: number;
  @IsString() country!: string;
  @IsString() client_ip_hash!: string;
}

export class IngestBatchDto {
  @ValidateNested({ each: true })
  @Type(() => IngestEventDto)
  events!: IngestEventDto[];
}
```

`apps/analytics-service/src/ingestion/events-internal.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard.js';
import { RequestLogWriter } from './request-log-writer.js';
import { IngestBatchDto } from './events-internal.dto.js';

@Controller('internal/analytics')
@UseGuards(InternalAuthGuard)
export class EventsInternalController {
  constructor(private readonly writer: RequestLogWriter) {}

  @Post('events')
  async ingest(@Body() dto: IngestBatchDto) {
    await this.writer.insertBatch(dto.events);
    return { ingested: dto.events.length };
  }
}
```

`apps/analytics-service/src/ingestion/ingestion-internal.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EventsInternalController } from './events-internal.controller.js';
import { InternalAuthGuard } from './internal-auth.guard.js';

@Module({
  controllers: [EventsInternalController],
  providers: [InternalAuthGuard],
})
export class IngestionInternalModule {}
```

Update `apps/analytics-service/src/app.module.ts`'s `imports` to include `IngestionInternalModule`.

- [ ] **Step 3: Write the integration test**

`apps/analytics-service/src/ingestion/events-internal.controller.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';

describe('EventsInternalController', () => {
  let app: INestApplication;
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await ch.close();
    await app.close();
  });

  it('rejects a request with no X-Internal-Secret header', async () => {
    const response = await request(app.getHttpServer()).post('/internal/analytics/events').send({ events: [] });
    expect(response.status).toBe(401);
  });

  it('ingests a batch of events with a valid secret', async () => {
    const zoneId = `internal-test-${Date.now()}`;
    const response = await request(app.getHttpServer())
      .post('/internal/analytics/events')
      .set('X-Internal-Secret', process.env.INTERNAL_API_SECRET ?? 'test_internal_secret_at_least_16_chars')
      .send({
        events: [
          {
            timestamp: '2026-06-29T10:00:00.000Z', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1',
            method: 'GET', path: '/x', status_code: 200, cache_status: 'HIT',
            bytes_sent: 42, duration_ms: 1, country: 'DE', client_ip_hash: 'hash3',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ingested: 1 });

    const resultSet = await ch.query({
      query: 'SELECT zone_id FROM request_logs WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    expect(await resultSet.json()).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @rivocloud/analytics-service test:integration`
Expected: PASS (make sure `INTERNAL_API_SECRET` is set to a 16+ char value in your test environment, matching `.env.example`).

- [ ] **Step 5: Commit**

```bash
git add apps/analytics-service/src/ingestion/ apps/analytics-service/src/app.module.ts
git commit -m "feat(analytics-service): add internal batch-ingest endpoint"
```

---

### Task 10: `analytics-service` — the 8 analytics REST endpoints

**Files:**
- Create: `apps/analytics-service/src/analytics/dto/analytics-query.dto.ts`
- Create: `apps/analytics-service/src/analytics/analytics.service.ts`
- Create: `apps/analytics-service/src/analytics/analytics.controller.ts`
- Create: `apps/analytics-service/src/analytics/analytics.module.ts`
- Test: `apps/analytics-service/src/analytics/analytics.controller.integration.test.ts`
- Modify: `apps/analytics-service/src/app.module.ts`

**Interfaces:**
- Consumes: `PRISMA`, `CLICKHOUSE` tokens, `AuthGuard`/`AnalyticsAccessGuard`/`AuthCtx` (Tasks 5–7).
- Produces: `GET /api/v1/analytics/{overview,bandwidth,requests,cache,geography,latency,status-codes,top-paths}`.

- [ ] **Step 1: Write the query DTO**

`apps/analytics-service/src/analytics/dto/analytics-query.dto.ts`:

```ts
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsIn(['hour', 'day', 'week']) granularity?: 'hour' | 'day' | 'week';
}
```

- [ ] **Step 2: Write `AnalyticsService`**

`apps/analytics-service/src/analytics/analytics.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import type { PrismaClient } from '@rivocloud/db';
import { CLICKHOUSE } from '../clickhouse/clickhouse.token.js';
import { PRISMA } from '../prisma/prisma.module.js';
import type { AnalyticsQueryDto } from './dto/analytics-query.dto.js';

function bucketFn(granularity: 'hour' | 'day' | 'week' = 'hour'): string {
  switch (granularity) {
    case 'day':
      return 'toStartOfDay';
    case 'week':
      return 'toStartOfWeek';
    default:
      return 'toStartOfHour';
  }
}

const EMPTY_RESULT_ZONE_IDS: string[] = [];

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(CLICKHOUSE) private readonly ch: ClickHouseClient,
    @Inject(PRISMA) private readonly db: PrismaClient,
  ) {}

  // Every zone_id column in ClickHouse is un-owned data — Postgres is the
  // only source of truth for "which org owns this zone" (this plan's Design
  // Decision 5), so every query resolves the caller's owned zone IDs first
  // and filters ClickHouse with zone_id IN (...) uniformly across all three
  // tables, rather than trusting an org_id column that doesn't even exist on
  // requests_by_country_daily.
  private async zoneIdsForOrg(orgId: string, zoneId?: string): Promise<string[]> {
    if (zoneId) {
      const zone = await this.db.pullZone.findUnique({ where: { id: zoneId } });
      if (!zone || zone.orgId !== orgId) {
        throw new NotFoundException('Zone not found');
      }
      return [zoneId];
    }
    const zones = await this.db.pullZone.findMany({ where: { orgId }, select: { id: true } });
    return zones.map((z) => z.id);
  }

  private range(query: AnalyticsQueryDto): { from: string; to: string } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  async overview(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { bytesSent: 0, requests: 0, hitRatio: 0 };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT sum(bytes_sent) AS bytesSent, count() AS requests, countIf(cache_status = 'HIT') AS cacheHits
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    const [row] = await resultSet.json<{ bytesSent: string; requests: string; cacheHits: string }>();
    const requests = Number(row?.requests ?? 0);
    const cacheHits = Number(row?.cacheHits ?? 0);
    return { bytesSent: Number(row?.bytesSent ?? 0), requests, hitRatio: requests > 0 ? cacheHits / requests : 0 };
  }

  async bandwidth(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { series: [] };
    const { from, to } = this.range(query);
    const bucket = bucketFn(query.granularity);
    const resultSet = await this.ch.query({
      query: `
        SELECT ${bucket}(hour) AS bucket, sum(bytes_sent) AS bytesSent, sum(requests) AS requests
        FROM bandwidth_hourly
        WHERE zone_id IN {zoneIds:Array(String)} AND hour BETWEEN {from:DateTime} AND {to:DateTime}
        GROUP BY bucket
        ORDER BY bucket
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { series: await resultSet.json() };
  }

  async requests(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { series: [] };
    const { from, to } = this.range(query);
    const bucket = bucketFn(query.granularity);
    const resultSet = await this.ch.query({
      query: `
        SELECT ${bucket}(timestamp) AS bucket, count() AS requests
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY bucket
        ORDER BY bucket
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { series: await resultSet.json() };
  }

  async cache(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { hitRatio: 0, breakdown: [] };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT cache_status AS cacheStatus, count() AS requests
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY cache_status
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    const breakdown = await resultSet.json<{ cacheStatus: string; requests: string }>();
    const total = breakdown.reduce((sum, row) => sum + Number(row.requests), 0);
    const hits = breakdown.find((row) => row.cacheStatus === 'HIT');
    return {
      hitRatio: total > 0 ? Number(hits?.requests ?? 0) / total : 0,
      breakdown: breakdown.map((row) => ({ cacheStatus: row.cacheStatus, requests: Number(row.requests) })),
    };
  }

  async geography(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { countries: [] };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT country, sum(requests) AS requests, sum(bytes_sent) AS bytesSent
        FROM requests_by_country_daily
        WHERE zone_id IN {zoneIds:Array(String)} AND date BETWEEN {from:Date} AND {to:Date}
        GROUP BY country
        ORDER BY requests DESC
        LIMIT 20
      `,
      query_params: { zoneIds, from: from.slice(0, 10), to: to.slice(0, 10) },
      format: 'JSONEachRow',
    });
    return { countries: await resultSet.json() };
  }

  async latency(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { series: [] };
    const { from, to } = this.range(query);
    const bucket = bucketFn(query.granularity);
    const resultSet = await this.ch.query({
      query: `
        SELECT
          ${bucket}(timestamp) AS bucket,
          quantile(0.50)(duration_ms) AS p50,
          quantile(0.95)(duration_ms) AS p95,
          quantile(0.99)(duration_ms) AS p99
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY bucket
        ORDER BY bucket
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { series: await resultSet.json() };
  }

  async statusCodes(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { breakdown: [] };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT status_code AS statusCode, count() AS requests
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY status_code
        ORDER BY requests DESC
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { breakdown: await resultSet.json() };
  }

  async topPaths(orgId: string, query: AnalyticsQueryDto) {
    const zoneIds = await this.zoneIdsForOrg(orgId, query.zoneId);
    if (zoneIds.length === 0) return { paths: [] };
    const { from, to } = this.range(query);
    const resultSet = await this.ch.query({
      query: `
        SELECT path, count() AS requests, sum(bytes_sent) AS bytesSent
        FROM request_logs
        WHERE zone_id IN {zoneIds:Array(String)} AND timestamp BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}
        GROUP BY path
        ORDER BY requests DESC
        LIMIT 50
      `,
      query_params: { zoneIds, from, to },
      format: 'JSONEachRow',
    });
    return { paths: await resultSet.json() };
  }
}
```

(`EMPTY_RESULT_ZONE_IDS` is unused — remove it; it was a leftover from drafting and every method already returns its own empty-shape literal directly.)

- [ ] **Step 3: Write the controller**

`apps/analytics-service/src/analytics/analytics.controller.ts`:

```ts
import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth-guard.js';
import { AnalyticsAccessGuard } from '../auth/analytics-access.guard.js';
import { AuthCtx, type CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsQueryDto } from './dto/analytics-query.dto.js';

function requireOrgId(auth: CombinedAuthContext): string {
  if (!auth.orgId) {
    throw new ForbiddenException('This credential is not scoped to an organization');
  }
  return auth.orgId;
}

@Controller('api/v1/analytics')
@UseGuards(AuthGuard, AnalyticsAccessGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.overview(requireOrgId(auth), query);
  }

  @Get('bandwidth')
  bandwidth(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.bandwidth(requireOrgId(auth), query);
  }

  @Get('requests')
  requests(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.requests(requireOrgId(auth), query);
  }

  @Get('cache')
  cache(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.cache(requireOrgId(auth), query);
  }

  @Get('geography')
  geography(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.geography(requireOrgId(auth), query);
  }

  @Get('latency')
  latency(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.latency(requireOrgId(auth), query);
  }

  @Get('status-codes')
  statusCodes(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.statusCodes(requireOrgId(auth), query);
  }

  @Get('top-paths')
  topPaths(@AuthCtx() auth: CombinedAuthContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.topPaths(requireOrgId(auth), query);
  }
}
```

`apps/analytics-service/src/analytics/analytics.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';

@Module({
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
```

Update `apps/analytics-service/src/app.module.ts`'s `imports` to include `AnalyticsModule`.

- [ ] **Step 4: Write the integration test (seeds Postgres + ClickHouse directly, exercises all 8 endpoints)**

`apps/analytics-service/src/analytics/analytics.controller.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { IdentityClient } from '../auth/identity-client.js';

class FakeIdentityClient {
  nextAuth: { type: 'jwt' | 'api_key'; userId: string; orgId: string; role: string | null; permissions?: string[] } | null = null;
  async verifyToken() {
    if (!this.nextAuth) throw new Error('no auth configured');
    return this.nextAuth;
  }
  async verifyApiKey() {
    if (!this.nextAuth) throw new Error('no auth configured');
    return this.nextAuth;
  }
}

describe('AnalyticsController', () => {
  let app: INestApplication;
  let ch: ClickHouseClient;
  let fakeIdentity: FakeIdentityClient;
  let orgId: string;
  let zoneId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityClient)
      .useClass(FakeIdentityClient)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    fakeIdentity = app.get(IdentityClient) as unknown as FakeIdentityClient;
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await ch.close();
    await app.close();
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({ data: { name: 'Analytics Test Org' } });
    orgId = org.id;
    const zone = await prisma.pullZone.create({
      data: { orgId, name: 'Test Zone', slug: `test-zone-${Date.now()}`, originUrl: 'https://api.example.com' },
    });
    zoneId = zone.id;
    fakeIdentity.nextAuth = { type: 'jwt', userId: 'u1', orgId, role: 'owner' };

    const now = '2026-06-29T10:00:00.000Z';
    await ch.insert({
      table: 'request_logs',
      values: [
        { timestamp: now, zone_id: zoneId, org_id: orgId, datacenter: 'dc1', method: 'GET', path: '/a', status_code: 200, cache_status: 'HIT', bytes_sent: 100, duration_ms: 10, country: 'DE', client_ip_hash: 'h1' },
        { timestamp: now, zone_id: zoneId, org_id: orgId, datacenter: 'dc1', method: 'GET', path: '/b', status_code: 404, cache_status: 'MISS', bytes_sent: 50, duration_ms: 20, country: 'FR', client_ip_hash: 'h2' },
      ],
      format: 'JSONEachRow',
    });
    await ch.insert({
      table: 'bandwidth_hourly',
      values: [{ hour: '2026-06-29 10:00:00', zone_id: zoneId, org_id: orgId, bytes_sent: 150, requests: 2, cache_hits: 1, cache_misses: 1 }],
      format: 'JSONEachRow',
    });
    await ch.insert({
      table: 'requests_by_country_daily',
      values: [{ date: '2026-06-29', zone_id: zoneId, country: 'DE', requests: 1, bytes_sent: 100 }],
      format: 'JSONEachRow',
    });
  });

  const authed = () => request(app.getHttpServer()).set('Authorization', 'Bearer test-token');
  const rangeQs = 'from=2026-06-29T00:00:00Z&to=2026-06-30T00:00:00Z';

  it('overview returns totals scoped to the org\'s zones', async () => {
    const response = await authed().get(`/api/v1/analytics/overview?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ bytesSent: 150, requests: 2, hitRatio: 0.5 });
  });

  it('bandwidth reads from the pre-computed rollup table', async () => {
    const response = await authed().get(`/api/v1/analytics/bandwidth?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.series).toHaveLength(1);
  });

  it('requests returns a time series from raw request_logs', async () => {
    const response = await authed().get(`/api/v1/analytics/requests?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.series).toHaveLength(1);
    expect(Number(response.body.series[0].requests)).toBe(2);
  });

  it('cache returns a hit ratio and status breakdown', async () => {
    const response = await authed().get(`/api/v1/analytics/cache?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.hitRatio).toBe(0.5);
    expect(response.body.breakdown).toHaveLength(2);
  });

  it('geography reads from the country rollup table', async () => {
    const response = await authed().get(`/api/v1/analytics/geography?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.countries).toEqual([{ country: 'DE', requests: '1', bytesSent: '100' }]);
  });

  it('latency returns quantiles', async () => {
    const response = await authed().get(`/api/v1/analytics/latency?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.series).toHaveLength(1);
  });

  it('status-codes returns a breakdown', async () => {
    const response = await authed().get(`/api/v1/analytics/status-codes?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.breakdown).toHaveLength(2);
  });

  it('top-paths returns both paths ordered by requests', async () => {
    const response = await authed().get(`/api/v1/analytics/top-paths?${rangeQs}`);
    expect(response.status).toBe(200);
    expect(response.body.paths).toHaveLength(2);
  });

  it('returns 404 when zoneId does not belong to the caller\'s org', async () => {
    const other = await prisma.organization.create({ data: { name: 'Other Org' } });
    const otherZone = await prisma.pullZone.create({
      data: { orgId: other.id, name: 'Other Zone', slug: `other-zone-${Date.now()}`, originUrl: 'https://api.example.com' },
    });
    const response = await authed().get(`/api/v1/analytics/overview?zoneId=${otherZone.id}&${rangeQs}`);
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @rivocloud/analytics-service test:integration`
Expected: PASS (9 tests). ClickHouse's numeric fields in `JSONEachRow` output arrive as strings for `UInt64` columns — the `geography` assertion above deliberately expects `'1'`/`'100'` as strings for that reason; the other endpoints' service code already normalizes via `Number(...)` before returning.

- [ ] **Step 6: Commit**

```bash
git add apps/analytics-service/src/analytics/ apps/analytics-service/src/app.module.ts
git commit -m "feat(analytics-service): add the 8 analytics aggregation endpoints"
```

---

### Task 11: Scheduler — ClickHouse rollup cron

**Files:**
- Create: `apps/scheduler/src/clickhouse/clickhouse.token.ts`, `schema.ts`, `schema.service.ts`, `clickhouse.module.ts` (duplicated from Task 6)
- Create: `apps/scheduler/src/analytics/rollup.service.ts`
- Create: `apps/scheduler/src/analytics/rollup.service.integration.test.ts`
- Create: `apps/scheduler/src/analytics/rollup.cron.ts`
- Create: `apps/scheduler/src/analytics/rollup.cron.test.ts`
- Create: `apps/scheduler/src/analytics/analytics-rollup.module.ts`
- Modify: `apps/scheduler/package.json` (+ `@clickhouse/client`)
- Modify: `apps/scheduler/src/env.ts` (+ `CLICKHOUSE_URL`)
- Modify: `apps/scheduler/src/app.module.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks in this service (duplicates the ClickHouse module per Design Decision 4).
- Produces: an hourly `bandwidth_hourly` rollup and a daily `requests_by_country_daily` rollup, both computed entirely inside ClickHouse.

- [ ] **Step 1: Add the ClickHouse client dependency and env var**

In `apps/scheduler/package.json`, add `"@clickhouse/client": "^1.9.1"` to `dependencies`.

In `apps/scheduler/src/env.ts`, add to the `envSchema.extend({...})` object:

```ts
  CLICKHOUSE_URL: z.string().url(),
```

- [ ] **Step 2: Duplicate the ClickHouse module (schema.ts, clickhouse.token.ts, schema.service.ts, clickhouse.module.ts)**

Create these four files identical to Task 6's versions in `apps/analytics-service/src/clickhouse/`, just under `apps/scheduler/src/clickhouse/` (same file names, same content — the import paths for `APP_ENV`/`AppEnv` already resolve correctly since both services use the same relative `../app-env.token.js`/`../env.js` layout).

Update `apps/scheduler/src/app.module.ts`'s `imports` to include `ClickhouseModule`.

- [ ] **Step 3: Write `RollupService`**

`apps/scheduler/src/analytics/rollup.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClickHouseClient } from '@clickhouse/client';
import { CLICKHOUSE } from '../clickhouse/clickhouse.token.js';

@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(@Inject(CLICKHOUSE) private readonly ch: ClickHouseClient) {}

  // Rolls up the full hour immediately before `now` — e.g. run at 14:03, it
  // rolls up [13:00, 14:00). ClickHouse's own INSERT INTO ... SELECT does
  // the aggregation server-side; SummingMergeTree merges same-key rows in
  // the background, so a re-run for the same hour is safe (this plan's
  // Design Decision 6).
  async rollupBandwidthForPreviousHour(now: Date = new Date()): Promise<void> {
    const hourStart = new Date(now);
    hourStart.setUTCMinutes(0, 0, 0);
    hourStart.setUTCHours(hourStart.getUTCHours() - 1);
    const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

    await this.ch.command({
      query: `
        INSERT INTO bandwidth_hourly (hour, zone_id, org_id, bytes_sent, requests, cache_hits, cache_misses)
        SELECT
          toStartOfHour(timestamp) AS hour,
          zone_id,
          org_id,
          sum(bytes_sent) AS bytes_sent,
          count() AS requests,
          countIf(cache_status = 'HIT') AS cache_hits,
          countIf(cache_status != 'HIT') AS cache_misses
        FROM request_logs
        WHERE timestamp >= {hourStart:DateTime64(3)} AND timestamp < {hourEnd:DateTime64(3)}
        GROUP BY hour, zone_id, org_id
      `,
      query_params: { hourStart: hourStart.toISOString(), hourEnd: hourEnd.toISOString() },
    });
    this.logger.log(`rolled up bandwidth_hourly for ${hourStart.toISOString()}`);
  }

  async rollupCountryForPreviousDay(now: Date = new Date()): Promise<void> {
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    dayStart.setUTCDate(dayStart.getUTCDate() - 1);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    await this.ch.command({
      query: `
        INSERT INTO requests_by_country_daily (date, zone_id, country, requests, bytes_sent)
        SELECT
          toDate(timestamp) AS date,
          zone_id,
          country,
          count() AS requests,
          sum(bytes_sent) AS bytes_sent
        FROM request_logs
        WHERE timestamp >= {dayStart:DateTime64(3)} AND timestamp < {dayEnd:DateTime64(3)}
        GROUP BY date, zone_id, country
      `,
      query_params: { dayStart: dayStart.toISOString(), dayEnd: dayEnd.toISOString() },
    });
    this.logger.log(`rolled up requests_by_country_daily for ${dayStart.toISOString().slice(0, 10)}`);
  }
}
```

`apps/scheduler/src/analytics/rollup.service.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { AppModule } from '../app.module.js';
import { RollupService } from './rollup.service.js';

describe('RollupService', () => {
  let app: INestApplication;
  let rollup: RollupService;
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    rollup = app.get(RollupService);
    ch = createClient({ url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123' });
  });

  afterAll(async () => {
    await ch.close();
    await app.close();
  });

  it('aggregates the previous hour of request_logs into bandwidth_hourly', async () => {
    const zoneId = `rollup-test-${Date.now()}`;
    // "now" fixed to 15:00 UTC so "the previous hour" is a known, fixed
    // window: [14:00, 15:00).
    const now = new Date('2026-07-01T15:00:00.000Z');
    await ch.insert({
      table: 'request_logs',
      values: [
        { timestamp: '2026-07-01 14:15:00.000', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/a', status_code: 200, cache_status: 'HIT', bytes_sent: 100, duration_ms: 5, country: 'DE', client_ip_hash: 'h1' },
        { timestamp: '2026-07-01 14:45:00.000', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/b', status_code: 200, cache_status: 'MISS', bytes_sent: 200, duration_ms: 8, country: 'DE', client_ip_hash: 'h2' },
      ],
      format: 'JSONEachRow',
    });

    await rollup.rollupBandwidthForPreviousHour(now);

    const resultSet = await ch.query({
      query: 'SELECT bytes_sent, requests, cache_hits, cache_misses FROM bandwidth_hourly WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ bytes_sent: string; requests: string; cache_hits: string; cache_misses: string }>();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].bytes_sent)).toBe(300);
    expect(Number(rows[0].requests)).toBe(2);
    expect(Number(rows[0].cache_hits)).toBe(1);
    expect(Number(rows[0].cache_misses)).toBe(1);
  });

  it('aggregates the previous day of request_logs into requests_by_country_daily', async () => {
    const zoneId = `rollup-daily-test-${Date.now()}`;
    const now = new Date('2026-07-02T00:30:00.000Z');
    await ch.insert({
      table: 'request_logs',
      values: [
        { timestamp: '2026-07-01 10:00:00.000', zone_id: zoneId, org_id: 'org1', datacenter: 'dc1', method: 'GET', path: '/a', status_code: 200, cache_status: 'HIT', bytes_sent: 50, duration_ms: 5, country: 'FR', client_ip_hash: 'h3' },
      ],
      format: 'JSONEachRow',
    });

    await rollup.rollupCountryForPreviousDay(now);

    const resultSet = await ch.query({
      query: 'SELECT country, requests, bytes_sent FROM requests_by_country_daily WHERE zone_id = {zoneId:String}',
      query_params: { zoneId },
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ country: string; requests: string; bytes_sent: string }>();
    expect(rows).toEqual([{ country: 'FR', requests: '1', bytes_sent: '50' }]);
  });
});
```

- [ ] **Step 4: Run the integration test**

Run: `pnpm --filter @rivocloud/scheduler test:integration`
Expected: PASS.

- [ ] **Step 5: Write the cron and its unit test**

`apps/scheduler/src/analytics/rollup.cron.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RollupService } from './rollup.service.js';

@Injectable()
export class RollupCron {
  private readonly logger = new Logger(RollupCron.name);

  constructor(private readonly rollup: RollupService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyBandwidth(): Promise<void> {
    try {
      await this.rollup.rollupBandwidthForPreviousHour();
    } catch (error) {
      this.logger.error(`hourly bandwidth rollup failed: ${(error as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDailyCountry(): Promise<void> {
    try {
      await this.rollup.rollupCountryForPreviousDay();
    } catch (error) {
      this.logger.error(`daily country rollup failed: ${(error as Error).message}`);
    }
  }
}
```

`apps/scheduler/src/analytics/rollup.cron.test.ts` (mirrors `domain-verification.cron.test.ts`'s style exactly):

```ts
import { describe, expect, it, vi } from 'vitest';
import { RollupCron } from './rollup.cron.js';
import type { RollupService } from './rollup.service.js';

describe('RollupCron', () => {
  it('delegates the hourly tick to RollupService.rollupBandwidthForPreviousHour', async () => {
    const rollupBandwidthForPreviousHour = vi.fn().mockResolvedValue(undefined);
    const cron = new RollupCron({ rollupBandwidthForPreviousHour } as unknown as RollupService);

    await cron.handleHourlyBandwidth();

    expect(rollupBandwidthForPreviousHour).toHaveBeenCalledOnce();
  });

  it('does not let a rejected hourly rollup crash the process', async () => {
    const rollupBandwidthForPreviousHour = vi.fn().mockRejectedValue(new Error('boom'));
    const cron = new RollupCron({ rollupBandwidthForPreviousHour } as unknown as RollupService);

    await expect(cron.handleHourlyBandwidth()).resolves.toBeUndefined();
  });

  it('delegates the daily tick to RollupService.rollupCountryForPreviousDay', async () => {
    const rollupCountryForPreviousDay = vi.fn().mockResolvedValue(undefined);
    const cron = new RollupCron({ rollupCountryForPreviousDay } as unknown as RollupService);

    await cron.handleDailyCountry();

    expect(rollupCountryForPreviousDay).toHaveBeenCalledOnce();
  });

  it('does not let a rejected daily rollup crash the process', async () => {
    const rollupCountryForPreviousDay = vi.fn().mockRejectedValue(new Error('boom'));
    const cron = new RollupCron({ rollupCountryForPreviousDay } as unknown as RollupService);

    await expect(cron.handleDailyCountry()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Wire the module into `app.module.ts`**

`apps/scheduler/src/analytics/analytics-rollup.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RollupService } from './rollup.service.js';
import { RollupCron } from './rollup.cron.js';

@Module({
  providers: [RollupService, RollupCron],
})
export class AnalyticsRollupModule {}
```

Update `apps/scheduler/src/app.module.ts`'s `imports` to include `ClickhouseModule` and `AnalyticsRollupModule` (both alongside the existing `DomainsModule`).

- [ ] **Step 7: Run all scheduler tests**

Run: `pnpm --filter @rivocloud/scheduler test:unit && pnpm --filter @rivocloud/scheduler test:integration`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/scheduler/package.json apps/scheduler/src/env.ts apps/scheduler/src/clickhouse/ apps/scheduler/src/analytics/ apps/scheduler/src/app.module.ts pnpm-lock.yaml
git commit -m "feat(scheduler): pre-compute bandwidth and country rollups on a schedule"
```

---

### Task 12: Dashboard — analytics proxy routes, hooks, and types

**Files:**
- Modify: `apps/dashboard/package.json` (+ `recharts`)
- Modify: `apps/dashboard/src/lib/env.ts` (+ `ANALYTICS_SERVICE_URL`)
- Modify: `apps/dashboard/src/lib/types.ts` (+ analytics response types)
- Create: `apps/dashboard/src/app/api/analytics/{overview,bandwidth,requests,cache,geography,latency,status-codes,top-paths}/route.ts`
- Create: `apps/dashboard/src/hooks/use-analytics.ts`
- Test: `apps/dashboard/src/hooks/use-analytics.test.ts`

**Interfaces:**
- Produces: `useAnalyticsOverview`, `useAnalyticsBandwidth`, `useAnalyticsRequests`, `useAnalyticsCache`, `useAnalyticsGeography`, `useAnalyticsLatency`, `useAnalyticsStatusCodes`, `useAnalyticsTopPaths` — consumed by Task 13's page and components.

- [ ] **Step 1: Add the `recharts` dependency and the `ANALYTICS_SERVICE_URL` env var**

In `apps/dashboard/package.json`, add `"recharts": "^2.13.0"` to `dependencies`.

In `apps/dashboard/src/lib/env.ts`, add to `envSchema`:

```ts
  ANALYTICS_SERVICE_URL: z.string().url(),
```

- [ ] **Step 2: Add analytics response types**

Append to `apps/dashboard/src/lib/types.ts`:

```ts
export interface AnalyticsOverview {
  bytesSent: number;
  requests: number;
  hitRatio: number;
}

export interface AnalyticsBandwidth {
  series: { bucket: string; bytesSent: number; requests: number }[];
}

export interface AnalyticsRequests {
  series: { bucket: string; requests: number }[];
}

export interface AnalyticsCache {
  hitRatio: number;
  breakdown: { cacheStatus: string; requests: number }[];
}

export interface AnalyticsGeography {
  countries: { country: string; requests: number; bytesSent: number }[];
}

export interface AnalyticsLatency {
  series: { bucket: string; p50: number; p95: number; p99: number }[];
}

export interface AnalyticsStatusCodes {
  breakdown: { statusCode: number; requests: number }[];
}

export interface AnalyticsTopPaths {
  paths: { path: string; requests: number; bytesSent: number }[];
}

export interface AnalyticsQueryParams {
  zoneId?: string;
  from?: string;
  to?: string;
  granularity?: 'hour' | 'day' | 'week';
}
```

- [ ] **Step 3: Write the 8 proxy routes**

`apps/dashboard/src/app/api/analytics/overview/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { proxyToBackend } from '@/lib/proxy';

export async function GET(request: NextRequest) {
  return proxyToBackend(getEnv().ANALYTICS_SERVICE_URL, `/api/v1/analytics/overview${request.nextUrl.search}`);
}
```

Repeat identically (only the path segment changes, both in the file's directory and the forwarded URL) for:
- `apps/dashboard/src/app/api/analytics/bandwidth/route.ts` → `/api/v1/analytics/bandwidth`
- `apps/dashboard/src/app/api/analytics/requests/route.ts` → `/api/v1/analytics/requests`
- `apps/dashboard/src/app/api/analytics/cache/route.ts` → `/api/v1/analytics/cache`
- `apps/dashboard/src/app/api/analytics/geography/route.ts` → `/api/v1/analytics/geography`
- `apps/dashboard/src/app/api/analytics/latency/route.ts` → `/api/v1/analytics/latency`
- `apps/dashboard/src/app/api/analytics/status-codes/route.ts` → `/api/v1/analytics/status-codes`
- `apps/dashboard/src/app/api/analytics/top-paths/route.ts` → `/api/v1/analytics/top-paths`

- [ ] **Step 4: Write the hooks**

`apps/dashboard/src/hooks/use-analytics.ts`:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/http';
import type {
  AnalyticsOverview,
  AnalyticsBandwidth,
  AnalyticsRequests,
  AnalyticsCache,
  AnalyticsGeography,
  AnalyticsLatency,
  AnalyticsStatusCodes,
  AnalyticsTopPaths,
  AnalyticsQueryParams,
} from '@/lib/types';

export function toSearchParams(params: AnalyticsQueryParams): string {
  const search = new URLSearchParams();
  if (params.zoneId) search.set('zoneId', params.zoneId);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.granularity) search.set('granularity', params.granularity);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function useAnalytics<T>(key: string, params: AnalyticsQueryParams) {
  return useQuery({
    queryKey: ['analytics', key, params],
    queryFn: () => apiFetch<T>(`/api/analytics/${key}${toSearchParams(params)}`),
  });
}

export const useAnalyticsOverview = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsOverview>('overview', params);
export const useAnalyticsBandwidth = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsBandwidth>('bandwidth', params);
export const useAnalyticsRequests = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsRequests>('requests', params);
export const useAnalyticsCache = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsCache>('cache', params);
export const useAnalyticsGeography = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsGeography>('geography', params);
export const useAnalyticsLatency = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsLatency>('latency', params);
export const useAnalyticsStatusCodes = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsStatusCodes>('status-codes', params);
export const useAnalyticsTopPaths = (params: AnalyticsQueryParams) => useAnalytics<AnalyticsTopPaths>('top-paths', params);
```

`apps/dashboard/src/hooks/use-analytics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toSearchParams } from './use-analytics.js';

describe('toSearchParams', () => {
  it('returns an empty string for no params', () => {
    expect(toSearchParams({})).toBe('');
  });

  it('includes only the params that are set', () => {
    expect(toSearchParams({ zoneId: 'zone-1', granularity: 'day' })).toBe('?zoneId=zone-1&granularity=day');
  });

  it('includes from/to when both are set', () => {
    const qs = toSearchParams({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
    expect(qs).toBe('?from=2026-01-01T00%3A00%3A00Z&to=2026-01-02T00%3A00%3A00Z');
  });
});
```

- [ ] **Step 5: Install and run**

Run: `pnpm install` (registers `recharts`), then `pnpm --filter @rivocloud/dashboard test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/src/lib/env.ts apps/dashboard/src/lib/types.ts apps/dashboard/src/app/api/analytics/ apps/dashboard/src/hooks/use-analytics.ts apps/dashboard/src/hooks/use-analytics.test.ts pnpm-lock.yaml
git commit -m "feat(dashboard): add analytics types, proxy routes, and query hooks"
```

---

### Task 13: Dashboard — Analytics page and chart components

**Files:**
- Create: `apps/dashboard/src/components/analytics/analytics-filters.tsx`
- Test: `apps/dashboard/src/components/analytics/analytics-filters.test.tsx`
- Create: `apps/dashboard/src/components/analytics/bandwidth-chart.tsx`
- Create: `apps/dashboard/src/components/analytics/cache-ratio-gauge.tsx`
- Create: `apps/dashboard/src/components/analytics/geography-table.tsx`
- Test: `apps/dashboard/src/components/analytics/geography-table.test.tsx`
- Create: `apps/dashboard/src/components/analytics/status-code-chart.tsx`
- Create: `apps/dashboard/src/components/analytics/latency-chart.tsx`
- Create: `apps/dashboard/src/app/(app)/analytics/page.tsx`
- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`

**Interfaces:**
- Consumes: the 8 hooks from Task 12, `useZones` (existing).

- [ ] **Step 1: Write `GeographyTable` and its test first (simplest, most valuable to test)**

`apps/dashboard/src/components/analytics/geography-table.tsx`:

```tsx
'use client';

import { useAnalyticsGeography } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function GeographyTable({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsGeography(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const countries = data?.countries ?? [];

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="pb-2">Country</th>
          <th className="pb-2">Requests</th>
        </tr>
      </thead>
      <tbody>
        {countries.map((row) => (
          <tr key={row.country}>
            <td className="py-1">{row.country}</td>
            <td className="py-1">{row.requests.toLocaleString()}</td>
          </tr>
        ))}
        {countries.length === 0 && (
          <tr>
            <td colSpan={2} className="py-4 text-muted-foreground">
              No data for this range.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
```

`apps/dashboard/src/components/analytics/geography-table.test.tsx` (mirrors `zone-domains.test.tsx`'s fetch-mocking convention):

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GeographyTable } from './geography-table';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('GeographyTable', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders an empty state when there is no country data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ countries: [] }), { status: 200 }));
    renderWithClient(<GeographyTable params={{}} />);
    expect(await screen.findByText(/no data for this range/i)).toBeInTheDocument();
  });

  it('renders a row per country', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ countries: [{ country: 'DE', requests: 42, bytesSent: 1000 }] }), { status: 200 }),
    );
    renderWithClient(<GeographyTable params={{}} />);
    expect(await screen.findByText('DE')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @rivocloud/dashboard test:unit`
Expected: PASS.

- [ ] **Step 3: Write the remaining (Recharts-backed) components**

`apps/dashboard/src/components/analytics/bandwidth-chart.tsx`:

```tsx
'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAnalyticsBandwidth } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function BandwidthChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsBandwidth(params);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data?.series ?? []}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tickFormatter={(v) => new Date(v).toLocaleString()} minTickGap={40} />
          <YAxis />
          <Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} />
          <Area type="monotone" dataKey="bytesSent" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

`apps/dashboard/src/components/analytics/cache-ratio-gauge.tsx`:

```tsx
'use client';

import { RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import { useAnalyticsCache } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function CacheRatioGauge({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsCache(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const pct = Math.round((data?.hitRatio ?? 0) * 100);
  return (
    <div className="flex h-48 flex-col items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="70%"
          outerRadius="100%"
          data={[{ name: 'hitRatio', value: pct, fill: '#22c55e' }]}
          startAngle={90}
          endAngle={-270}
        >
          <RadialBar dataKey="value" background cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <p className="-mt-32 text-2xl font-semibold">{pct}%</p>
      <p className="mt-32 text-sm text-muted-foreground">Cache hit ratio</p>
    </div>
  );
}
```

`apps/dashboard/src/components/analytics/status-code-chart.tsx`:

```tsx
'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useAnalyticsStatusCodes } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

const COLORS = ['#22c55e', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6'];

export function StatusCodeChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsStatusCodes(params);
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  const breakdown = data?.breakdown ?? [];
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={breakdown} dataKey="requests" nameKey="statusCode" innerRadius={40} outerRadius={70}>
            {breakdown.map((entry, i) => (
              <Cell key={entry.statusCode} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

`apps/dashboard/src/components/analytics/latency-chart.tsx`:

```tsx
'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAnalyticsLatency } from '@/hooks/use-analytics';
import type { AnalyticsQueryParams } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export function LatencyChart({ params }: { params: AnalyticsQueryParams }) {
  const { data, isLoading } = useAnalyticsLatency(params);
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data?.series ?? []}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bucket" tickFormatter={(v) => new Date(v).toLocaleString()} minTickGap={40} />
          <YAxis />
          <Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} />
          <Line type="monotone" dataKey="p50" stroke="#22c55e" dot={false} />
          <Line type="monotone" dataKey="p95" stroke="#f59e0b" dot={false} />
          <Line type="monotone" dataKey="p99" stroke="#ef4444" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Write `AnalyticsFilters` and its test**

`apps/dashboard/src/components/analytics/analytics-filters.tsx`:

```tsx
'use client';

import { useZones } from '@/hooks/use-zones';
import type { AnalyticsQueryParams } from '@/lib/types';

const RANGE_PRESETS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export type AnalyticsFilterState = AnalyticsQueryParams & { rangeKey: string };

export function AnalyticsFilters({
  params,
  onChange,
}: {
  params: AnalyticsFilterState;
  onChange: (next: AnalyticsFilterState) => void;
}) {
  const { data } = useZones();

  function setRange(rangeKey: string) {
    const to = new Date();
    const from = new Date(to.getTime() - RANGE_PRESETS[rangeKey]);
    onChange({ ...params, rangeKey, from: from.toISOString(), to: to.toISOString() });
  }

  return (
    <div className="flex items-center gap-3">
      <select
        aria-label="Zone"
        className="rounded border border-border bg-background px-2 py-1 text-sm"
        value={params.zoneId ?? ''}
        onChange={(e) => onChange({ ...params, zoneId: e.target.value || undefined })}
      >
        <option value="">All zones</option>
        {(data?.zones ?? []).map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Range"
        className="rounded border border-border bg-background px-2 py-1 text-sm"
        value={params.rangeKey}
        onChange={(e) => setRange(e.target.value)}
      >
        {Object.keys(RANGE_PRESETS).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </div>
  );
}
```

`apps/dashboard/src/components/analytics/analytics-filters.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsFilters } from './analytics-filters';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AnalyticsFilters', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ zones: [{ id: 'zone-1', name: 'My Blog' }] }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('calls onChange with the selected zoneId', async () => {
    const onChange = vi.fn();
    renderWithClient(<AnalyticsFilters params={{ rangeKey: '24h' }} onChange={onChange} />);

    const zoneSelect = await screen.findByLabelText('Zone');
    fireEvent.change(zoneSelect, { target: { value: 'zone-1' } });

    expect(onChange).toHaveBeenCalledWith({ rangeKey: '24h', zoneId: 'zone-1' });
  });

  it('calls onChange with a new from/to when the range changes', async () => {
    const onChange = vi.fn();
    renderWithClient(<AnalyticsFilters params={{ rangeKey: '24h' }} onChange={onChange} />);

    const rangeSelect = await screen.findByLabelText('Range');
    fireEvent.change(rangeSelect, { target: { value: '7d' } });

    expect(onChange).toHaveBeenCalledOnce();
    const arg = onChange.mock.calls[0][0];
    expect(arg.rangeKey).toBe('7d');
    expect(arg.from).toBeTruthy();
    expect(arg.to).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @rivocloud/dashboard test:unit`
Expected: PASS.

- [ ] **Step 6: Write the Analytics page and add it to navigation**

`apps/dashboard/src/app/(app)/analytics/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { AnalyticsFilters, type AnalyticsFilterState } from '@/components/analytics/analytics-filters';
import { BandwidthChart } from '@/components/analytics/bandwidth-chart';
import { CacheRatioGauge } from '@/components/analytics/cache-ratio-gauge';
import { GeographyTable } from '@/components/analytics/geography-table';
import { StatusCodeChart } from '@/components/analytics/status-code-chart';
import { LatencyChart } from '@/components/analytics/latency-chart';

export default function AnalyticsPage() {
  const [params, setParams] = useState<AnalyticsFilterState>({ rangeKey: '24h' });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <AnalyticsFilters params={params} onChange={setParams} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Bandwidth</h2>
          <BandwidthChart params={params} />
        </div>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Cache hit ratio</h2>
          <CacheRatioGauge params={params} />
        </div>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Latency (P50/P95/P99)</h2>
          <LatencyChart params={params} />
        </div>
        <div className="rounded border border-border p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Status codes</h2>
          <StatusCodeChart params={params} />
        </div>
        <div className="rounded border border-border p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Requests by country</h2>
          <GeographyTable params={params} />
        </div>
      </div>
    </div>
  );
}
```

In `apps/dashboard/src/components/layout/app-shell.tsx`, add to `NAV_ITEMS`:

```ts
  { href: '/analytics', label: 'Analytics' },
```

(placed after `{ href: '/zones', label: 'Zones' }`, before `{ href: '/storage', label: 'Storage' }`).

- [ ] **Step 7: Manual verification**

Run: `pnpm --filter @rivocloud/dashboard dev`, log in, click "Analytics" in the top nav, confirm the page renders without console errors (charts will show empty states with no seeded ClickHouse data locally — that's expected).

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/components/analytics/ apps/dashboard/src/app/\(app\)/analytics/ apps/dashboard/src/components/layout/app-shell.tsx
git commit -m "feat(dashboard): add the Analytics page with bandwidth, cache, latency, and geography charts"
```

---

### Task 14: Docs — mark Stage 9 done

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`
- Modify: `docs/concepts/analytics-and-clickhouse.md`

- [ ] **Step 1: Mark the PRD roadmap row done**

In `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`'s Section 7 roadmap table, change row 9's Status cell from `Not started` to `✅ Done`.

- [ ] **Step 2: Update the concept doc's intro to past tense**

In `docs/concepts/analytics-and-clickhouse.md`, replace the opening two paragraphs (the `# Analytics & ClickHouse` header's first paragraph and the "Stage 9 has not been built yet" sentence) with wording matching the already-completed concept docs' style (e.g. `docs/concepts/custom-domains-and-tls.md`'s intro):

```markdown
This document explains **Stage 9 (Analytics)** of RivoCloud's Phase 1 build order — the pipeline that turns raw, individual visitor requests into the bandwidth graphs, cache-hit-ratio charts, and latency numbers a customer sees on their dashboard. Everything below describes what was built, matching the design in:
```

(keeping the existing bulleted spec-reference list immediately after unchanged).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md docs/concepts/analytics-and-clickhouse.md
git commit -m "docs: mark Stage 9 done in the PRD"
```

---

## Self-Review

**Spec coverage:**
- EDD 2.5 (Analytics Service responsibilities: NATS subscribe, batch-insert, aggregation queries, rollup pre-compute) → Tasks 2, 3, 8, 10, 11.
- EDD 6.6 (three ClickHouse tables) → Task 6 (and duplicated in Task 11).
- EDD 7.7 (8 analytics endpoints) → Task 10.
- EDD 7.9 (internal batch-ingest endpoint) → Task 9.
- EDD 11 block 9.1–9.4 (edge emit → ingest → aggregate → dashboard charts) → Tasks 3, 8, 10, 13.
- PRD 5.7 (cache hit/miss ratio, bandwidth, request counts, geography, latency visible per zone, updated close to real time) → Task 13's page + Task 8's 5-second flush interval.
- Concept doc's walkthrough (rollup tables serve bandwidth/geography; raw table serves everything else) → Design Decision 8, Task 10.

**Placeholder scan:** no TBD/TODO markers; the one leftover (`EMPTY_RESULT_ZONE_IDS` in Task 10 Step 2) is explicitly called out as dead code to delete in the same step, not left ambiguous.

**Type consistency:** `EdgeRequestEvent`'s snake_case fields (Task 8) match `analytics.Event`'s JSON tags (Task 2) exactly. `AnalyticsQueryDto`'s `zoneId`/`from`/`to`/`granularity` (Task 10) match `AnalyticsQueryParams` (Task 12) and `toSearchParams` (Task 12) exactly. `CombinedAuthContext`/`AuthGuard`/`AnalyticsAccessGuard` (Task 7) match the shape `AnalyticsController` (Task 10) expects. `RollupService`'s two method names (Task 11) match what `RollupCron` calls exactly.

