# Phase 1 — Stage 3: Go Edge Proxy (Basic) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/edge-proxy` (Go) — a reverse-proxy CDN edge server with a 3-layer cache (in-process LRU → Redis → origin) — so a request to an uncached path is a cache miss and the same request seconds later is a cache hit, per the PRD's Stage 3 roadmap entry and the Month 2 "Core CDN Proxy" deliverable.

**Architecture:** A single Go binary (`apps/edge-proxy`) with no dependency on `@rivocloud/db` or any other app — it talks only to Redis (L2 cache) and to a hardcoded set of zone configs (origin URLs), matching the EDD's explicit Stage 3 scoping: "Stage 3 deliberately uses a hardcoded zone config rather than waiting for the CDN Service." One HTTP handler (`proxy.CachingHandler`) implements the entire request pipeline (zone lookup → cache-key construction → check cache layers fastest-to-slowest → forward to origin on a full miss → apply Cache-Control/ETag rules → populate cache layers); the same handler is reused, unmodified, across all three build sub-steps (3.1 bare forwarding with zero layers, 3.2 with Redis as the only layer, 3.3 with an in-process LRU added in front of Redis) — later tasks add layers to the handler's `Layers` slice, they never rewrite the handler.

**Tech Stack:** Go 1.23, standard library `net/http`/`net/http/httputil` for the HTTP server and reverse-proxy plumbing, `github.com/redis/go-redis/v9` for the L2 cache, `github.com/hashicorp/golang-lru/v2` for the L1 cache. Go's built-in `testing` package + `net/http/httptest` for all tests (no third-party test library — matches Go idiom and keeps this first Go service's dependency list minimal). A thin `package.json` per app wraps `go` commands so `pnpm turbo lint typecheck test:unit test:integration build` keeps working uniformly across the monorepo, exactly as `apps/identity-service` already does for its own toolchain.

**Spec:** [`docs/superpowers/specs/2026-06-29-revocloud-phase1-cdn-edd.md`](../specs/2026-06-29-revocloud-phase1-cdn-edd.md) (Section 2.1 "Edge Proxy (Go)", Section 5 "CDN Architecture" — specifically 5.1–5.4 and 5.7), [`docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`](../specs/2026-07-25-revocloud-phase1-prd.md) (Section 7, roadmap row 3), and [`docs/concepts/edge-proxy-and-caching.md`](../../concepts/edge-proxy-and-caching.md) (the sub-step build sequence this plan follows directly: 3.1 → 3.2 → 3.3).

## Global Constraints

- **This stage is deliberately narrow.** In scope: bare HTTP reverse proxying, cache-key construction with query-string normalization, the 3-layer cache (L1 in-process LRU / L2 Redis / L3 origin), `Cache-Control`/`Expires`/`ETag`/`If-None-Match` handling, `stale-if-error` fallback, gzip compression (brotli explicitly deferred per the Month 2 task list). Out of scope, deferred to later stages per the PRD roadmap and the concept doc's own "what this basic build deliberately does not include yet": custom domains/TLS (Stage 8), NATS cache invalidation and the cache-rules engine (Stage 7 — so **Priority 1** of the EDD's five-priority TTL hierarchy, a per-path zone cache rule, does not exist yet; this stage's `Decide` function only implements Priorities 2–4), signed URLs (Stage 10), Range requests, analytics event emission (Stage 9), and real (database-backed) zone configuration (CDN Service is Stage 4 — zone configs stay a hardcoded Go literal in `main.go` this stage). NATS is not touched at all in this stage: the Month 2 roadmap's "NATS setup: basic pub/sub between CDN Service and Edge Proxy" bullet requires a CDN Service that doesn't exist until Stage 4, and the PRD's own risk table (Section 8) states the dependency-ordered roadmap (Section 11) is authoritative over the month-ordered one (Section 10) whenever they disagree.
- **No OpenTelemetry instrumentation**, following the precedent already set by Stage 2 (the PRD's Month 1 task list and NFR table call for OTel, but `apps/identity-service` was built without it — confirmed by inspecting its source). Not scope-creeping into an NFR no earlier stage actually implemented either.
- **Go module path:** `rivocloud/edge-proxy` — a private, unpublished module; nothing imports it from outside this app, so the path never needs to resolve to a real host. **Go version: 1.23.**
- **No Go toolchain or running Docker daemon existed on this dev machine at plan-writing time.** Docker Desktop has since been started and verified (`docker run --rm golang:1.23-alpine go version` succeeds). Every build/lint/test command in this plan therefore runs inside a `golang:1.23-alpine` container via the `apps/edge-proxy/scripts/go-docker.sh` helper (Task 1) rather than a natively-installed `go` binary — CI (Task 9) is unaffected and uses `actions/setup-go` natively, since GitHub's runners have no such constraint.
- **Docker-Desktop-on-Windows host-networking deviation:** containers reach the host's Redis (from `infrastructure/compose/docker-compose.infra.yml`) via `host.docker.internal`, not `localhost` — `localhost` inside a container refers to the container itself. `go-docker.sh` rewrites `$REDIS_URL` accordingly before invoking `docker run`. This rewrite is a local-dev-only concern; CI's `REDIS_URL=redis://localhost:6379` (already set in `.github/workflows/ci.yml`) is correct as-is on a native Linux runner and is not touched.
- **Cache key** (EDD Section 5.2, exactly as written): `sha256(zone_id|method|normalized_host|normalized_path|normalized_query)`, where method is always `GET` (HEAD requests are folded to `GET` before hashing, per RFC 7231 §4.3.2 — HEAD shares GET's cache entry, body stripped on write), host is lowercased with any `:port` suffix stripped, path is lowercased with repeated `/` collapsed, and the query string has every parameter kept (Stage 3 has no per-zone whitelist/strip configuration yet — that requires the zone-config fields CDN Service, Stage 4, will add) but sorted by key then value for determinism. `Vary`-based key variance is out of scope this stage (not listed under the Month 2 task list); the response `Vary: Accept-Encoding` header is still set for HTTP correctness once gzip variants exist (Task 7), even though it doesn't affect the key.
- **TTL priority this stage** (EDD Section 5.3, Priorities 2–4 only — Priority 1 needs Stage 7's cache rules, Priority 5's content-type default is unreachable in this stage's scope since Priority 4 always applies when the origin sends nothing): origin `Cache-Control: max-age=N` → origin `Expires:` header → the zone's configured default TTL. `no-store`/`private` from the origin means never cache; `no-cache` means cache but with TTL 0 (always revalidate via `If-None-Match` before serving again). Every cacheable entry gets a `stale-if-error` window, default 24h, overridable by the origin's own `stale-if-error=N` directive — on origin failure, an expired-but-still-within-that-window entry is served with `X-RivoCloud-Cache: STALE` instead of a 502.
- **Browser-facing `Cache-Control` is constructed by the proxy, never forwarded from origin** (EDD Section 5.3, "Browser TTL vs Edge TTL are independent"): `public, max-age=<seconds remaining until the edge entry's own TTL expires>` when cacheable, `no-store` when not.
- **`X-RivoCloud-Cache` response header** takes exactly one of three values (per the concept doc's own quick-reference diagram): `HIT` (served from L1 or L2 without contacting the origin, including a 304-revalidated entry), `MISS` (the origin was contacted and returned a body), `STALE` (an expired entry served because the origin was unreachable, within its `stale-if-error` window).
- **gzip only, not brotli** (Month 2 task list: "gzip compression (skip brotli until Month 4)"). Compressible content types: `text/html`, `text/css`, `text/plain`, `application/javascript`, `application/json`, `application/xml` — matches EDD Section 5.7's list exactly.
- Every relative Go import is a normal Go import path (`rivocloud/edge-proxy/internal/...`) — Go has no equivalent of the TypeScript-services' `moduleResolution: NodeNext` `.js`-extension requirement; this constraint from Stage 2's plan does not apply here.
- Every package.json script for this app shells out to Go via `bash scripts/go-docker.sh ...` (never a bare `./scripts/go-docker.sh` — Windows' `cmd.exe`, which pnpm/turbo invoke package.json scripts through by default, does not honor shebang lines or the executable bit; `bash.exe` is confirmed present on this machine's `PATH` via Git for Windows).

---

### Task 1: Scaffold `apps/edge-proxy`

**Files:**
- Create: `apps/edge-proxy/go.mod`
- Create: `apps/edge-proxy/scripts/go-docker.sh`
- Create: `apps/edge-proxy/internal/health/health.go`
- Create: `apps/edge-proxy/internal/health/health_test.go`
- Create: `apps/edge-proxy/cmd/edge-proxy/main.go`
- Create: `apps/edge-proxy/package.json`
- Modify: `.env.example` (append Edge Proxy section)

**Interfaces:**
- Consumes: nothing yet.
- Produces: `health.NewHandler() http.Handler` (serves `GET /healthz` → `200 {"status":"ok"}`), the `bash scripts/go-docker.sh <cmd...>` convention every later task's package.json scripts and manual verification commands use to run Go inside the `golang:1.23-alpine` container with `REDIS_URL` rewritten for container networking.

- [ ] **Step 1: Create `apps/edge-proxy/scripts/go-docker.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
WIN_REPO_ROOT="$(cygpath -w "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")"

# Containers can't reach the host (Redis, or the manual-verification origin
# server) via "localhost" — Docker Desktop exposes the host as
# host.docker.internal instead. Local-dev-only workaround for this machine
# having no native Go toolchain; CI runs Go natively via actions/setup-go,
# where localhost is correct as-is.
rewrite_localhost() {
  local value="${1:-}"
  value="${value/127.0.0.1/host.docker.internal}"
  value="${value/localhost/host.docker.internal}"
  echo "$value"
}

CONTAINER_REDIS_URL="$(rewrite_localhost "${REDIS_URL:-redis://localhost:6379}")"
CONTAINER_ORIGIN_URL="$(rewrite_localhost "${EDGE_PROXY_DEMO_ORIGIN_URL:-http://localhost:9999}")"
CONTAINER_PORT="${EDGE_PROXY_PORT:-8888}"

DOCKER_ARGS=(
  --rm
  -v "${WIN_REPO_ROOT}://workspace"
  -w "//workspace/apps/edge-proxy"
  -e CGO_ENABLED=0
  -e GOFLAGS=-mod=mod
  -e REDIS_URL="${CONTAINER_REDIS_URL}"
  -e EDGE_PROXY_PORT="${CONTAINER_PORT}"
  -e EDGE_PROXY_DEMO_ORIGIN_URL="${CONTAINER_ORIGIN_URL}"
  -e EDGE_PROXY_L1_MAX_ENTRIES="${EDGE_PROXY_L1_MAX_ENTRIES:-}"
)

# Only `go run` binds a port something outside the container needs to reach
# (manual verification, Task 9) — publish it only then. Publishing
# unconditionally would make concurrent `lint`/`typecheck`/`test:unit`
# invocations (turbo may run a package's own tasks concurrently — none of
# them declare a dependsOn ordering against each other) race for the same
# host port and fail with "address already in use".
if [ "${1:-}" = "go" ] && [ "${2:-}" = "run" ]; then
  DOCKER_ARGS+=(-p "${CONTAINER_PORT}:${CONTAINER_PORT}")
fi

docker run "${DOCKER_ARGS[@]}" golang:1.23-alpine "$@"
```

- [ ] **Step 2: Make it executable and initialize the Go module**

```bash
chmod +x apps/edge-proxy/scripts/go-docker.sh
cd apps/edge-proxy
bash scripts/go-docker.sh go mod init rivocloud/edge-proxy
cd ../..
```

Expected: creates `apps/edge-proxy/go.mod` containing `module rivocloud/edge-proxy` and a `go 1.23` (or newer patch) directive.

- [ ] **Step 3: Write the failing test for the health handler**

`apps/edge-proxy/internal/health/health_test.go`:

```go
package health

import (
	"net/http/httptest"
	"testing"
)

func TestHealthzReturnsOK(t *testing.T) {
	req := httptest.NewRequest("GET", "/healthz", nil)
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	want := "{\"status\":\"ok\"}\n"
	if got := rec.Body.String(); got != want {
		t.Fatalf("expected body %q, got %q", want, got)
	}
}
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/health/... -v
cd ../..
```

Expected: FAIL — `undefined: NewHandler` (compile error, `health.go` doesn't exist yet).

- [ ] **Step 5: Implement the minimal health handler**

`apps/edge-proxy/internal/health/health.go`:

```go
package health

import (
	"encoding/json"
	"net/http"
)

// NewHandler returns the Edge Proxy's liveness endpoint. It is deliberately
// its own tiny package so cmd/edge-proxy/main.go stays a thin wiring layer.
func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	return mux
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/health/... -v
cd ../..
```

Expected: PASS.

- [ ] **Step 7: Write `cmd/edge-proxy/main.go`**

```go
package main

import (
	"log"
	"net/http"
	"os"

	"rivocloud/edge-proxy/internal/health"
)

func main() {
	port := os.Getenv("EDGE_PROXY_PORT")
	if port == "" {
		port = "8888"
	}
	log.Printf("edge-proxy listening on :%s", port)
	if err := http.ListenAndServe(":"+port, health.NewHandler()); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 8: Verify it builds**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go build -o /tmp/edge-proxy-typecheck/ ./...
cd ../..
```

Expected: exits 0, no output.

- [ ] **Step 9: Write `apps/edge-proxy/package.json`**

```json
{
  "name": "@rivocloud/edge-proxy",
  "private": true,
  "scripts": {
    "lint": "bash scripts/go-docker.sh sh -c \"gofmt -l . && go vet ./...\"",
    "typecheck": "bash scripts/go-docker.sh go build -o /tmp/edge-proxy-typecheck/ ./...",
    "test:unit": "bash scripts/go-docker.sh go test ./...",
    "test:integration": "bash scripts/go-docker.sh go test -tags=integration ./...",
    "build": "bash scripts/go-docker.sh go build -o dist/edge-proxy ./cmd/edge-proxy",
    "dev": "bash scripts/go-docker.sh go run ./cmd/edge-proxy"
  }
}
```

- [ ] **Step 10: Append the Edge Proxy section to `.env.example`**

Add at the end of `.env.example`:

```
# Edge Proxy
EDGE_PROXY_PORT=8888
```

- [ ] **Step 11: Verify the workspace picks up the new package and the turbo pipeline runs it**

```bash
pnpm install
pnpm turbo lint typecheck test:unit --filter=@rivocloud/edge-proxy
```

Expected: all three tasks run (via Docker under the hood) and succeed; `pnpm install` links the new workspace member (pnpm-workspace.yaml already globs `apps/*`, so no config change is needed).

- [ ] **Step 12: Commit**

```bash
git add apps/edge-proxy/go.mod apps/edge-proxy/go.sum apps/edge-proxy/scripts/go-docker.sh apps/edge-proxy/internal/health apps/edge-proxy/cmd/edge-proxy/main.go apps/edge-proxy/package.json .env.example pnpm-lock.yaml
git commit -m "feat: scaffold apps/edge-proxy Go service with health check"
```

---

### Task 2: Zone registry and cache-key construction

**Files:**
- Create: `apps/edge-proxy/internal/zone/zone.go`
- Create: `apps/edge-proxy/internal/zone/zone_test.go`
- Create: `apps/edge-proxy/internal/cachekey/cachekey.go`
- Create: `apps/edge-proxy/internal/cachekey/cachekey_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `zone.Config{ID, Host, OriginURL, DefaultTTL}`, `zone.Registry` interface with `Resolve(host string) (Config, bool)`, `zone.NewStaticRegistry(zones []Config) *StaticRegistry`. `cachekey.Build(zoneID, method, host, path, rawQuery string) string`, `cachekey.NormalizeMethod(method string) string`. Every later task resolves zones and builds keys through exactly these names.

- [ ] **Step 1: Write the failing zone registry tests**

`apps/edge-proxy/internal/zone/zone_test.go`:

```go
package zone

import "testing"

func TestResolve_MatchesCaseInsensitiveHostIgnoringPort(t *testing.T) {
	r := NewStaticRegistry([]Config{
		{ID: "z1", Host: "Demo.CDN.Rivocloud.dev", OriginURL: "http://localhost:9999"},
	})

	got, ok := r.Resolve("demo.cdn.rivocloud.dev:8888")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if got.ID != "z1" {
		t.Fatalf("expected zone z1, got %s", got.ID)
	}
}

func TestResolve_UnknownHostNotFound(t *testing.T) {
	r := NewStaticRegistry([]Config{{ID: "z1", Host: "demo.cdn.rivocloud.dev"}})

	_, ok := r.Resolve("someone-else.example.com")
	if ok {
		t.Fatal("expected unknown host to not resolve")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/zone/... -v
cd ../..
```

Expected: FAIL — `undefined: NewStaticRegistry` / `undefined: Config`.

- [ ] **Step 3: Implement the zone registry**

`apps/edge-proxy/internal/zone/zone.go`:

```go
package zone

import (
	"strings"
	"time"
)

// Config describes one CDN zone: which inbound Host header it matches and
// which origin server requests are forwarded to. Stage 3 hardcodes these in
// main.go; the CDN Service (Stage 4) later replaces StaticRegistry with a
// Redis-backed one implementing the same Registry interface.
type Config struct {
	ID         string
	Host       string
	OriginURL  string
	DefaultTTL time.Duration
}

// Registry resolves an inbound request's Host header to a zone Config.
type Registry interface {
	Resolve(host string) (Config, bool)
}

// StaticRegistry is a Registry backed by a fixed, in-memory map.
type StaticRegistry struct {
	zones map[string]Config
}

func NewStaticRegistry(zones []Config) *StaticRegistry {
	m := make(map[string]Config, len(zones))
	for _, z := range zones {
		m[normalizeHost(z.Host)] = z
	}
	return &StaticRegistry{zones: m}
}

func (r *StaticRegistry) Resolve(host string) (Config, bool) {
	z, ok := r.zones[normalizeHost(host)]
	return z, ok
}

func normalizeHost(host string) string {
	host = strings.ToLower(host)
	if i := strings.IndexByte(host, ':'); i != -1 {
		host = host[:i]
	}
	return host
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/zone/... -v
cd ../..
```

Expected: PASS.

- [ ] **Step 5: Write the failing cache-key tests**

`apps/edge-proxy/internal/cachekey/cachekey_test.go`:

```go
package cachekey

import "testing"

func TestBuild_QueryParamOrderDoesNotChangeKey(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/search", "a=1&b=2")
	b := Build("zone1", "GET", "cdn.example.com", "/search", "b=2&a=1")
	if a != b {
		t.Fatalf("expected identical keys, got %q and %q", a, b)
	}
}

func TestBuild_DifferentHostOrPathChangesKey(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "/a", "")
	b := Build("zone1", "GET", "cdn.example.com", "/b", "")
	if a == b {
		t.Fatal("expected different paths to produce different keys")
	}
}

func TestBuild_HostIsNormalized(t *testing.T) {
	a := Build("zone1", "GET", "CDN.Example.com:443", "/a", "")
	b := Build("zone1", "GET", "cdn.example.com", "/a", "")
	if a != b {
		t.Fatal("expected host case and port to be normalized away")
	}
}

func TestBuild_PathSlashesCollapsed(t *testing.T) {
	a := Build("zone1", "GET", "cdn.example.com", "//a///b", "")
	b := Build("zone1", "GET", "cdn.example.com", "/a/b", "")
	if a != b {
		t.Fatal("expected repeated slashes to collapse")
	}
}

func TestNormalizeMethod_HeadFoldsToGet(t *testing.T) {
	if got := NormalizeMethod("HEAD"); got != "GET" {
		t.Fatalf("expected HEAD to fold to GET, got %s", got)
	}
	if got := NormalizeMethod("head"); got != "GET" {
		t.Fatalf("expected lowercase head to fold to GET, got %s", got)
	}
	if got := NormalizeMethod("POST"); got != "POST" {
		t.Fatalf("expected POST to pass through unchanged, got %s", got)
	}
}
```

- [ ] **Step 6: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/cachekey/... -v
cd ../..
```

Expected: FAIL — `undefined: Build` / `undefined: NormalizeMethod`.

- [ ] **Step 7: Implement cache-key construction**

`apps/edge-proxy/internal/cachekey/cachekey.go`:

```go
package cachekey

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strings"
)

// Build constructs the canonical cache key for a request, per the EDD's
// cache-key design (Section 5.2): zone + method + normalized host/path/query,
// hashed with SHA-256.
func Build(zoneID, method, host, path, rawQuery string) string {
	h := sha256.New()
	h.Write([]byte(zoneID))
	h.Write([]byte{'|'})
	h.Write([]byte(strings.ToUpper(method)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizeHost(host)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizePath(path)))
	h.Write([]byte{'|'})
	h.Write([]byte(normalizeQuery(rawQuery)))
	return hex.EncodeToString(h.Sum(nil))
}

// NormalizeMethod folds HEAD into GET for cache-key purposes (HEAD shares
// GET's cache entry, RFC 7231 §4.3.2); every other method passes through.
func NormalizeMethod(method string) string {
	if strings.EqualFold(method, "HEAD") {
		return "GET"
	}
	return method
}

func normalizeHost(host string) string {
	host = strings.ToLower(host)
	if i := strings.IndexByte(host, ':'); i != -1 {
		host = host[:i]
	}
	return host
}

func normalizePath(path string) string {
	path = strings.ToLower(path)
	for strings.Contains(path, "//") {
		path = strings.ReplaceAll(path, "//", "/")
	}
	return path
}

func normalizeQuery(rawQuery string) string {
	values, err := url.ParseQuery(rawQuery)
	if err != nil || len(values) == 0 {
		return ""
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	first := true
	for _, k := range keys {
		vs := append([]string{}, values[k]...)
		sort.Strings(vs)
		for _, v := range vs {
			if !first {
				b.WriteByte('&')
			}
			first = false
			b.WriteString(k)
			b.WriteByte('=')
			b.WriteString(v)
		}
	}
	return b.String()
}
```

- [ ] **Step 8: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/cachekey/... -v
cd ../..
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/edge-proxy/internal/zone apps/edge-proxy/internal/cachekey
git commit -m "feat: add edge-proxy zone registry and cache-key construction"
```

---

### Task 3: Cache-Control / TTL / ETag decision logic

**Files:**
- Create: `apps/edge-proxy/internal/httpcache/httpcache.go`
- Create: `apps/edge-proxy/internal/httpcache/httpcache_test.go`

**Interfaces:**
- Consumes: nothing (pure functions over `http.Header` and `time.Time`).
- Produces: `httpcache.Decision{Cacheable, TTL, StaleIfErrorTTL, MustRevalidate}`, `httpcache.Decide(header http.Header, zoneDefaultTTL time.Duration, now time.Time) Decision`, `httpcache.BrowserCacheControl(d Decision, remaining time.Duration) string`, `httpcache.DefaultStaleIfError` (24h). Task 6's `CachingHandler` calls these by these exact names.

- [ ] **Step 1: Write the failing tests**

`apps/edge-proxy/internal/httpcache/httpcache_test.go`:

```go
package httpcache

import (
	"net/http"
	"testing"
	"time"
)

func decideAt(t *testing.T, headers map[string]string, zoneDefault time.Duration) Decision {
	t.Helper()
	h := http.Header{}
	for k, v := range headers {
		h.Set(k, v)
	}
	return Decide(h, zoneDefault, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
}

func TestDecide_NoStoreIsNeverCacheable(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "no-store"}, time.Hour)
	if d.Cacheable {
		t.Fatal("expected no-store to be non-cacheable")
	}
}

func TestDecide_PrivateIsNeverCacheable(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "private"}, time.Hour)
	if d.Cacheable {
		t.Fatal("expected private to be non-cacheable")
	}
}

func TestDecide_NoCacheMustRevalidateWithZeroTTL(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "no-cache"}, time.Hour)
	if !d.Cacheable || !d.MustRevalidate || d.TTL != 0 {
		t.Fatalf("expected cacheable+must-revalidate+TTL 0, got %+v", d)
	}
}

func TestDecide_MaxAgeWins(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "max-age=120"}, time.Hour)
	if !d.Cacheable || d.TTL != 120*time.Second {
		t.Fatalf("expected TTL 120s, got %+v", d)
	}
}

func TestDecide_ExpiresUsedWhenNoMaxAge(t *testing.T) {
	d := decideAt(t, map[string]string{"Expires": "Thu, 01 Jan 2026 00:05:00 GMT"}, time.Hour)
	if !d.Cacheable || d.TTL != 5*time.Minute {
		t.Fatalf("expected TTL 5m from Expires, got %+v", d)
	}
}

func TestDecide_ZoneDefaultWhenOriginSendsNoFreshnessHeader(t *testing.T) {
	d := decideAt(t, map[string]string{}, 30*time.Minute)
	if !d.Cacheable || d.TTL != 30*time.Minute {
		t.Fatalf("expected zone default TTL, got %+v", d)
	}
}

func TestDecide_StaleIfErrorDefaultsTo24Hours(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "max-age=60"}, time.Hour)
	if d.StaleIfErrorTTL != DefaultStaleIfError {
		t.Fatalf("expected default stale-if-error of 24h, got %s", d.StaleIfErrorTTL)
	}
}

func TestDecide_OriginStaleIfErrorOverridesDefault(t *testing.T) {
	d := decideAt(t, map[string]string{"Cache-Control": "max-age=60, stale-if-error=120"}, time.Hour)
	if d.StaleIfErrorTTL != 120*time.Second {
		t.Fatalf("expected overridden stale-if-error of 120s, got %s", d.StaleIfErrorTTL)
	}
}

func TestBrowserCacheControl_NonCacheableIsNoStore(t *testing.T) {
	got := BrowserCacheControl(Decision{Cacheable: false}, 0)
	if got != "no-store" {
		t.Fatalf("expected no-store, got %q", got)
	}
}

func TestBrowserCacheControl_CacheableUsesRemainingTTL(t *testing.T) {
	got := BrowserCacheControl(Decision{Cacheable: true}, 42*time.Second)
	if got != "public, max-age=42" {
		t.Fatalf("expected public max-age=42, got %q", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/httpcache/... -v
cd ../..
```

Expected: FAIL — `undefined: Decide` / `undefined: Decision` / `undefined: BrowserCacheControl` / `undefined: DefaultStaleIfError`.

- [ ] **Step 3: Implement the decision logic**

`apps/edge-proxy/internal/httpcache/httpcache.go`:

```go
package httpcache

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DefaultStaleIfError is applied when the origin doesn't specify its own
// stale-if-error window (EDD Section 5.3: "RivoCloud always adds
// stale-if-error: 86400 (24 hours) for cached objects unless origin
// explicitly disables it").
const DefaultStaleIfError = 24 * time.Hour

// Decision is the outcome of applying the EDD's Cache-Control priority
// hierarchy (Section 5.3), scoped to what Stage 3 implements: origin
// max-age (Priority 2), origin Expires (Priority 3), and the zone default
// TTL (Priority 4). Priority 1 (a per-path cache rule) needs Stage 7's
// cache-rules engine; Priority 5 (a content-type default) is unreachable
// here because Priority 4 always applies when the origin sends nothing.
type Decision struct {
	Cacheable       bool
	TTL             time.Duration
	StaleIfErrorTTL time.Duration
	MustRevalidate  bool
}

// Decide inspects an origin response's headers and returns whether, and for
// how long, the edge should cache it.
func Decide(header http.Header, zoneDefaultTTL time.Duration, now time.Time) Decision {
	cc := parseCacheControl(header.Get("Cache-Control"))

	if cc.noStore || cc.private {
		return Decision{Cacheable: false}
	}

	staleIfError := DefaultStaleIfError
	if cc.staleIfError >= 0 {
		staleIfError = cc.staleIfError
	}

	if cc.noCache {
		return Decision{Cacheable: true, TTL: 0, StaleIfErrorTTL: staleIfError, MustRevalidate: true}
	}

	if cc.maxAge >= 0 {
		return Decision{Cacheable: true, TTL: cc.maxAge, StaleIfErrorTTL: staleIfError}
	}

	if exp := header.Get("Expires"); exp != "" {
		if t, err := http.ParseTime(exp); err == nil {
			if ttl := t.Sub(now); ttl > 0 {
				return Decision{Cacheable: true, TTL: ttl, StaleIfErrorTTL: staleIfError}
			}
			return Decision{Cacheable: true, TTL: 0, StaleIfErrorTTL: staleIfError, MustRevalidate: true}
		}
	}

	return Decision{Cacheable: true, TTL: zoneDefaultTTL, StaleIfErrorTTL: staleIfError}
}

// BrowserCacheControl builds the Cache-Control header sent to the visitor's
// browser, independent of how long the edge itself caches the object (EDD
// Section 5.3, "Browser TTL vs Edge TTL").
func BrowserCacheControl(d Decision, remaining time.Duration) string {
	if !d.Cacheable {
		return "no-store"
	}
	if remaining < 0 {
		remaining = 0
	}
	return "public, max-age=" + strconv.Itoa(int(remaining.Seconds()))
}

type cacheControl struct {
	noStore      bool
	private      bool
	noCache      bool
	maxAge       time.Duration
	staleIfError time.Duration
}

func parseCacheControl(raw string) cacheControl {
	cc := cacheControl{maxAge: -1, staleIfError: -1}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		lower := strings.ToLower(part)
		switch {
		case lower == "no-store":
			cc.noStore = true
		case lower == "private":
			cc.private = true
		case lower == "no-cache":
			cc.noCache = true
		case strings.HasPrefix(lower, "max-age="):
			if secs, err := strconv.Atoi(part[len("max-age="):]); err == nil {
				if secs < 0 {
					secs = 0
				}
				cc.maxAge = time.Duration(secs) * time.Second
			}
		case strings.HasPrefix(lower, "stale-if-error="):
			if secs, err := strconv.Atoi(part[len("stale-if-error="):]); err == nil {
				cc.staleIfError = time.Duration(secs) * time.Second
			}
		}
	}
	return cc
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/httpcache/... -v
cd ../..
```

Expected: PASS (all 10 test cases).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-proxy/internal/httpcache
git commit -m "feat: add edge-proxy Cache-Control/TTL/ETag decision logic"
```

---

### Task 4: Cache storage — Entry type, Layer interface, in-process LRU, Redis

**Files:**
- Create: `apps/edge-proxy/internal/cachestore/entry.go`
- Create: `apps/edge-proxy/internal/cachestore/entry_test.go`
- Create: `apps/edge-proxy/internal/cachestore/layer.go`
- Create: `apps/edge-proxy/internal/cachestore/memory.go`
- Create: `apps/edge-proxy/internal/cachestore/memory_test.go`
- Create: `apps/edge-proxy/internal/cachestore/redis.go`
- Create: `apps/edge-proxy/internal/cachestore/redis_integration_test.go`

**Interfaces:**
- Consumes: `httpcache.Decision` fields are not imported here — `Entry`'s `ExpiresAt`/`StaleUntil` are pre-computed absolute times, decoupling this package from `httpcache`.
- Produces: `cachestore.Entry{StatusCode, Header, Body, ETag, Cacheable, StoredAt, ExpiresAt, StaleUntil}` with methods `Fresh(now time.Time) bool` and `UsableAsStale(now time.Time) bool`; `cachestore.Layer` interface (`Get(ctx, key) (Entry, bool, error)`, `Set(ctx, key, entry) error`); `cachestore.NewMemory(maxEntries int) (*Memory, error)`; `cachestore.NewRedis(client *redis.Client, prefix string) *Redis`. Task 6's `CachingHandler` is built entirely against the `Layer` interface.

- [ ] **Step 1: Write the failing Entry tests**

`apps/edge-proxy/internal/cachestore/entry_test.go`:

```go
package cachestore

import (
	"testing"
	"time"
)

func TestEntry_FreshBeforeExpiry(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e := Entry{ExpiresAt: now.Add(time.Minute)}
	if !e.Fresh(now) {
		t.Fatal("expected entry to be fresh before its ExpiresAt")
	}
}

func TestEntry_NotFreshAfterExpiry(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e := Entry{ExpiresAt: now.Add(-time.Second)}
	if e.Fresh(now) {
		t.Fatal("expected entry to not be fresh after its ExpiresAt")
	}
}

func TestEntry_UsableAsStaleWithinWindow(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e := Entry{ExpiresAt: now.Add(-time.Hour), StaleUntil: now.Add(time.Hour)}
	if !e.UsableAsStale(now) {
		t.Fatal("expected entry to be usable as stale within its window")
	}
}

func TestEntry_NotUsableAsStalePastWindow(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e := Entry{StaleUntil: now.Add(-time.Second)}
	if e.UsableAsStale(now) {
		t.Fatal("expected entry to not be usable as stale past its window")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/cachestore/... -v
cd ../..
```

Expected: FAIL — `undefined: Entry`.

- [ ] **Step 3: Implement `Entry` and the `Layer` interface**

`apps/edge-proxy/internal/cachestore/entry.go`:

```go
package cachestore

import (
	"net/http"
	"time"
)

// Entry is a single cached response, stored identically in every layer so
// the proxy handler can treat L1 and L2 the same way.
type Entry struct {
	StatusCode int
	Header     http.Header
	Body       []byte
	ETag       string
	Cacheable  bool
	StoredAt   time.Time
	ExpiresAt  time.Time // edge TTL deadline — past this, revalidate
	StaleUntil time.Time // absolute deadline for serving this on origin error
}

func (e Entry) Fresh(now time.Time) bool {
	return now.Before(e.ExpiresAt)
}

func (e Entry) UsableAsStale(now time.Time) bool {
	return now.Before(e.StaleUntil)
}
```

`apps/edge-proxy/internal/cachestore/layer.go`:

```go
package cachestore

import "context"

// Layer is one level of the 3-layer cache (L1 in-process LRU or L2 Redis).
// The proxy handler checks layers fastest-to-slowest and populates faster
// layers on a slower-layer hit (EDD Section 2.1).
type Layer interface {
	Get(ctx context.Context, key string) (Entry, bool, error)
	Set(ctx context.Context, key string, entry Entry) error
}
```

- [ ] **Step 4: Run to verify the Entry tests pass**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/cachestore/... -v
cd ../..
```

Expected: PASS.

- [ ] **Step 5: Write the failing Memory (L1) tests**

`apps/edge-proxy/internal/cachestore/memory_test.go`:

```go
package cachestore

import (
	"context"
	"testing"
)

func TestMemory_SetThenGetReturnsSameEntry(t *testing.T) {
	m, err := NewMemory(10)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	want := Entry{StatusCode: 200, Body: []byte("hello")}

	if err := m.Set(ctx, "key1", want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := m.Get(ctx, "key1")
	if err != nil || !ok {
		t.Fatalf("expected hit, got ok=%v err=%v", ok, err)
	}
	if string(got.Body) != "hello" {
		t.Fatalf("expected body 'hello', got %q", got.Body)
	}
}

func TestMemory_GetMissReturnsFalse(t *testing.T) {
	m, err := NewMemory(10)
	if err != nil {
		t.Fatal(err)
	}
	_, ok, err := m.Get(context.Background(), "missing")
	if err != nil || ok {
		t.Fatalf("expected miss, got ok=%v err=%v", ok, err)
	}
}

func TestMemory_EvictsLeastRecentlyUsedWhenFull(t *testing.T) {
	m, err := NewMemory(1)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	_ = m.Set(ctx, "first", Entry{Body: []byte("1")})
	_ = m.Set(ctx, "second", Entry{Body: []byte("2")})

	_, ok, _ := m.Get(ctx, "first")
	if ok {
		t.Fatal("expected 'first' to have been evicted once capacity was exceeded")
	}
	_, ok, _ = m.Get(ctx, "second")
	if !ok {
		t.Fatal("expected 'second' to still be present")
	}
}
```

- [ ] **Step 6: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/cachestore/... -v
cd ../..
```

Expected: FAIL — `undefined: NewMemory`.

- [ ] **Step 7: Add the LRU dependency and implement Memory**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go get github.com/hashicorp/golang-lru/v2
cd ../..
```

`apps/edge-proxy/internal/cachestore/memory.go`:

```go
package cachestore

import (
	"context"

	lru "github.com/hashicorp/golang-lru/v2"
)

// Memory is the L1 in-process cache: an LRU of a fixed maximum entry count,
// not shared between Edge Proxy replicas (EDD Section 2.1).
type Memory struct {
	cache *lru.Cache[string, Entry]
}

func NewMemory(maxEntries int) (*Memory, error) {
	c, err := lru.New[string, Entry](maxEntries)
	if err != nil {
		return nil, err
	}
	return &Memory{cache: c}, nil
}

func (m *Memory) Get(_ context.Context, key string) (Entry, bool, error) {
	e, ok := m.cache.Get(key)
	return e, ok, nil
}

func (m *Memory) Set(_ context.Context, key string, entry Entry) error {
	m.cache.Add(key, entry)
	return nil
}
```

- [ ] **Step 8: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/cachestore/... -v
cd ../..
```

Expected: PASS.

- [ ] **Step 9: Ensure Redis is running, then write the failing Redis (L2) integration test**

```bash
docker compose -f infrastructure/compose/docker-compose.infra.yml up -d redis
```

`apps/edge-proxy/internal/cachestore/redis_integration_test.go`:

```go
//go:build integration

package cachestore

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func newTestRedisLayer(t *testing.T) *Redis {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("invalid REDIS_URL %q: %v", url, err)
	}
	client := redis.NewClient(opts)
	t.Cleanup(func() { client.Close() })
	return NewRedis(client, "edge-proxy-test:")
}

func TestRedis_SetThenGetReturnsSameEntry(t *testing.T) {
	r := newTestRedisLayer(t)
	ctx := context.Background()
	now := time.Now()
	want := Entry{
		StatusCode: 200,
		Body:       []byte("hello from redis"),
		ETag:       "abc123",
		Cacheable:  true,
		StoredAt:   now,
		ExpiresAt:  now.Add(time.Minute),
		StaleUntil: now.Add(time.Hour),
	}

	if err := r.Set(ctx, "redis-key1", want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := r.Get(ctx, "redis-key1")
	if err != nil || !ok {
		t.Fatalf("expected hit, got ok=%v err=%v", ok, err)
	}
	if string(got.Body) != "hello from redis" || got.ETag != "abc123" {
		t.Fatalf("unexpected entry: %+v", got)
	}
}

func TestRedis_GetMissReturnsFalse(t *testing.T) {
	r := newTestRedisLayer(t)
	_, ok, err := r.Get(context.Background(), "does-not-exist")
	if err != nil || ok {
		t.Fatalf("expected miss, got ok=%v err=%v", ok, err)
	}
}

func TestRedis_EntryPastStaleUntilIsNotStored(t *testing.T) {
	r := newTestRedisLayer(t)
	ctx := context.Background()
	past := Entry{Body: []byte("too old"), StaleUntil: time.Now().Add(-time.Hour)}

	if err := r.Set(ctx, "redis-key-expired", past); err != nil {
		t.Fatal(err)
	}
	_, ok, err := r.Get(ctx, "redis-key-expired")
	if err != nil || ok {
		t.Fatalf("expected an already-stale entry to not be stored, got ok=%v err=%v", ok, err)
	}
}
```

- [ ] **Step 10: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/cachestore/... -run TestRedis -v
cd ../..
```

Expected: FAIL — `undefined: Redis` / `undefined: NewRedis`.

- [ ] **Step 11: Add the Redis client dependency and implement the Redis layer**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go get github.com/redis/go-redis/v9@v9.18.0
cd ../..
```

Pinned to `v9.18.0` deliberately: v9.19.0+ (including true latest, v9.22.0) raised their own `go.mod`'s Go floor to 1.24, which conflicts with this plan's Go 1.23 constraint (an unpinned `go get` fails outright here, or silently bumps the toolchain requirement). `v9.18.0` is the newest tag still declaring `go 1.21`, and the API surface this task uses (`ParseURL`, `NewClient`, `redis.Nil`, `Client.Get(...).Bytes()`, `Client.Set(...)`) is unchanged across the whole v9 line, so nothing else about this task changes.

`apps/edge-proxy/internal/cachestore/redis.go`:

```go
package cachestore

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis is the L2 cache: shared by every Edge Proxy replica in a PoP
// (EDD Section 2.1).
type Redis struct {
	client *redis.Client
	prefix string
}

func NewRedis(client *redis.Client, prefix string) *Redis {
	return &Redis{client: client, prefix: prefix}
}

func (r *Redis) Get(ctx context.Context, key string) (Entry, bool, error) {
	raw, err := r.client.Get(ctx, r.prefix+key).Bytes()
	if errors.Is(err, redis.Nil) {
		return Entry{}, false, nil
	}
	if err != nil {
		return Entry{}, false, err
	}
	var e Entry
	if err := json.Unmarshal(raw, &e); err != nil {
		return Entry{}, false, err
	}
	return e, true, nil
}

func (r *Redis) Set(ctx context.Context, key string, entry Entry) error {
	ttl := time.Until(entry.StaleUntil)
	if ttl <= 0 {
		return nil // already past its stale-if-error deadline; not worth storing
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, r.prefix+key, raw, ttl).Err()
}
```

- [ ] **Step 12: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/cachestore/... -run TestRedis -v
cd ../..
```

Expected: PASS (all 3 Redis integration tests).

- [ ] **Step 13: Commit**

```bash
git add apps/edge-proxy/internal/cachestore apps/edge-proxy/go.mod apps/edge-proxy/go.sum
git commit -m "feat: add edge-proxy cache Entry type, Layer interface, in-process LRU, and Redis layer"
```

---

### Task 5: Reverse-proxy handler — Stage 3.1 (bare forwarding, zero cache layers)

**Files:**
- Create: `apps/edge-proxy/internal/proxy/handler.go`
- Create: `apps/edge-proxy/internal/proxy/handler_integration_test.go`
- Modify: `apps/edge-proxy/cmd/edge-proxy/main.go`

**Interfaces:**
- Consumes: `zone.Registry`/`zone.Config` (Task 2), `cachekey.Build`/`NormalizeMethod` (Task 2), `httpcache.Decide`/`Decision` (Task 3), `cachestore.Entry`/`Layer` (Task 4).
- Produces: `proxy.OriginFetcher` interface (`Do(req *http.Request) (*http.Response, error)`, satisfied directly by `*http.Client`), `proxy.CachingHandler{Zones, Layers, Origin, Now}` implementing `http.Handler`. This exact type is reused unmodified by Task 6 (which sets `Layers` to `[]cachestore.Layer{redisLayer}`) and Task 8 (which prepends a `Memory` layer) — no later task rewrites `ServeHTTP`.

- [ ] **Step 1: Write the failing integration test for bare forwarding**

`apps/edge-proxy/internal/proxy/handler_integration_test.go`:

```go
//go:build integration

package proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/zone"
)

func TestCachingHandler_NoLayers_ForwardsRequestAndRelaysResponseUntouched(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("expected origin to receive /hello, got %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello from origin"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/hello", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if string(body) != "hello from origin" {
		t.Fatalf("expected body from origin, got %q", body)
	}
	if got := rec.Header().Get("X-RivoCloud-Cache"); got != "MISS" {
		t.Fatalf("expected X-RivoCloud-Cache: MISS with no cache layers, got %q", got)
	}
}

func TestCachingHandler_UnknownZoneReturns404(t *testing.T) {
	zones := zone.NewStaticRegistry(nil)
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://unknown.test/anything", nil)
	req.Host = "unknown.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown zone, got %d", rec.Code)
	}
}

func TestCachingHandler_NonGetMethodIsProxiedUncached(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected origin to receive POST, got %s", r.Method)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("POST", "http://demo.test/submit", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 relayed from origin, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/proxy/... -v
cd ../..
```

Expected: FAIL — `undefined: CachingHandler`.

- [ ] **Step 3: Implement the handler**

`apps/edge-proxy/internal/proxy/handler.go`:

```go
package proxy

import (
	"context"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"rivocloud/edge-proxy/internal/cachekey"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/httpcache"
	"rivocloud/edge-proxy/internal/zone"
)

// OriginFetcher is satisfied directly by *http.Client; tests inject a
// client whose Transport can simulate origin failures.
type OriginFetcher interface {
	Do(req *http.Request) (*http.Response, error)
}

// CachingHandler implements the Edge Proxy's entire request pipeline (EDD
// Section 2.1): resolve a zone, build a cache key, check Layers
// fastest-to-slowest, forward to origin on a miss, apply Cache-Control/ETag
// rules, populate Layers. The SAME handler backs every Stage 3 sub-step:
// with Layers empty (this task) it behaves as bare forwarding (3.1); Task 6
// sets Layers to Redis only (3.2); Task 8 prepends an in-process LRU (3.3).
type CachingHandler struct {
	Zones  zone.Registry
	Layers []cachestore.Layer // checked in order; index 0 is fastest
	Origin OriginFetcher
	Now    func() time.Time
}

func (h *CachingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	z, ok := h.Zones.Resolve(r.Host)
	if !ok {
		http.Error(w, "unknown zone", http.StatusNotFound)
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		h.proxyUncached(w, r, z)
		return
	}

	key := cachekey.Build(z.ID, cachekey.NormalizeMethod(r.Method), r.Host, r.URL.Path, r.URL.RawQuery)
	now := h.now()

	entry, hitLayerIdx, found := h.lookup(r.Context(), key)
	if found && entry.Fresh(now) {
		h.populateFasterLayers(r.Context(), key, entry, hitLayerIdx)
		writeEntry(w, r, entry, now, "HIT")
		return
	}

	etag := ""
	if found {
		etag = entry.ETag
	}
	result, err := h.fetchOrigin(r, z, etag)
	if err != nil {
		if found && entry.UsableAsStale(now) {
			writeEntry(w, r, entry, now, "STALE")
			return
		}
		http.Error(w, "origin unreachable", http.StatusBadGateway)
		return
	}

	if result.notModified {
		refreshed := refreshExpiry(entry, result.decision, now)
		h.store(r.Context(), key, refreshed)
		writeEntry(w, r, refreshed, now, "HIT")
		return
	}

	defer result.response.Body.Close()
	body, err := io.ReadAll(result.response.Body)
	if err != nil {
		http.Error(w, "error reading origin response", http.StatusBadGateway)
		return
	}
	newEntry := buildEntry(result.response, body, result.decision, now)
	if result.decision.Cacheable {
		h.store(r.Context(), key, newEntry)
	}
	writeEntry(w, r, newEntry, now, "MISS")
}

func (h *CachingHandler) proxyUncached(w http.ResponseWriter, r *http.Request, z zone.Config) {
	result, err := h.fetchOrigin(r, z, "")
	if err != nil {
		http.Error(w, "origin unreachable", http.StatusBadGateway)
		return
	}
	defer result.response.Body.Close()
	for k, vs := range result.response.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(result.response.StatusCode)
	io.Copy(w, result.response.Body)
}

type originResult struct {
	response    *http.Response
	notModified bool
	decision    httpcache.Decision
}

func (h *CachingHandler) fetchOrigin(r *http.Request, z zone.Config, etag string) (*originResult, error) {
	target, err := url.Parse(z.OriginURL)
	if err != nil {
		return nil, err
	}

	outReq := r.Clone(r.Context())
	outReq.URL.Scheme = target.Scheme
	outReq.URL.Host = target.Host
	outReq.URL.Path = r.URL.Path
	outReq.Host = target.Host
	outReq.RequestURI = ""
	// The client's own Accept-Encoding must never reach the origin: with no
	// Accept-Encoding header at all, Go's http.Transport adds its own
	// "Accept-Encoding: gzip" and transparently decompresses the response
	// (stripping Content-Encoding/Content-Length before we ever see them).
	// Forwarding the client's header verbatim disables that transparent
	// decompression — a gzip-aware origin would then hand back a real
	// gzip body that gets cached as "identity" and re-gzipped by Task 7's
	// negotiateEncoding, corrupting it for every client that requests it.
	outReq.Header.Del("Accept-Encoding")
	if etag != "" {
		outReq.Header.Set("If-None-Match", etag)
	}

	resp, err := h.Origin.Do(outReq)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusNotModified {
		decision := httpcache.Decide(resp.Header, z.DefaultTTL, h.now())
		resp.Body.Close()
		return &originResult{notModified: true, decision: decision}, nil
	}

	decision := httpcache.Decide(resp.Header, z.DefaultTTL, h.now())
	return &originResult{response: resp, decision: decision}, nil
}

func (h *CachingHandler) lookup(ctx context.Context, key string) (cachestore.Entry, int, bool) {
	for i, layer := range h.Layers {
		if layer == nil {
			continue
		}
		entry, ok, err := layer.Get(ctx, key)
		if err != nil {
			log.Printf("cache layer %d get error: %v", i, err)
			continue
		}
		if ok {
			return entry, i, true
		}
	}
	return cachestore.Entry{}, -1, false
}

func (h *CachingHandler) populateFasterLayers(ctx context.Context, key string, entry cachestore.Entry, hitLayerIdx int) {
	for i := 0; i < hitLayerIdx; i++ {
		if h.Layers[i] == nil {
			continue
		}
		if err := h.Layers[i].Set(ctx, key, entry); err != nil {
			log.Printf("cache layer %d set error: %v", i, err)
		}
	}
}

func (h *CachingHandler) store(ctx context.Context, key string, entry cachestore.Entry) {
	for i, layer := range h.Layers {
		if layer == nil {
			continue
		}
		if err := layer.Set(ctx, key, entry); err != nil {
			log.Printf("cache layer %d set error: %v", i, err)
		}
	}
}

func (h *CachingHandler) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func buildEntry(resp *http.Response, body []byte, decision httpcache.Decision, now time.Time) cachestore.Entry {
	header := resp.Header.Clone()
	header.Del("Cache-Control")
	header.Del("Expires")
	header.Del("ETag")
	header.Del("Content-Length")
	header.Del("Connection")
	header.Del("Transfer-Encoding")
	header.Del("Set-Cookie")
	header.Set("Content-Length", strconv.Itoa(len(body)))

	return cachestore.Entry{
		StatusCode: resp.StatusCode,
		Header:     header,
		Body:       body,
		ETag:       resp.Header.Get("ETag"),
		Cacheable:  decision.Cacheable,
		StoredAt:   now,
		ExpiresAt:  now.Add(decision.TTL),
		StaleUntil: now.Add(decision.TTL).Add(decision.StaleIfErrorTTL),
	}
}

func refreshExpiry(entry cachestore.Entry, decision httpcache.Decision, now time.Time) cachestore.Entry {
	entry.StoredAt = now
	entry.ExpiresAt = now.Add(decision.TTL)
	entry.StaleUntil = now.Add(decision.TTL).Add(decision.StaleIfErrorTTL)
	return entry
}

func writeEntry(w http.ResponseWriter, r *http.Request, entry cachestore.Entry, now time.Time, source string) {
	for k, vs := range entry.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	remaining := entry.ExpiresAt.Sub(now)
	w.Header().Set("Cache-Control", httpcache.BrowserCacheControl(httpcache.Decision{Cacheable: entry.Cacheable}, remaining))
	w.Header().Set("Vary", "Accept-Encoding")
	w.Header().Set("X-RivoCloud-Cache", source)
	if entry.ETag != "" {
		w.Header().Set("ETag", entry.ETag)
	}
	w.WriteHeader(entry.StatusCode)
	if r.Method == http.MethodHead {
		return
	}
	w.Write(entry.Body)
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/proxy/... -v
cd ../..
```

Expected: PASS (all 3 tests).

- [ ] **Step 5: Wire the handler into `main.go` with the hardcoded demo zone**

Replace the contents of `apps/edge-proxy/cmd/edge-proxy/main.go`:

```go
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"rivocloud/edge-proxy/internal/health"
	"rivocloud/edge-proxy/internal/proxy"
	"rivocloud/edge-proxy/internal/zone"
)

func main() {
	port := os.Getenv("EDGE_PROXY_PORT")
	if port == "" {
		port = "8888"
	}

	// Stage 3 hardcodes zone configuration on purpose (EDD Section 2.1,
	// concept doc Section 6) — the CDN Service (Stage 4) replaces this with
	// a database-and-Redis-backed registry.
	zones := zone.NewStaticRegistry([]zone.Config{
		{
			ID:         "demo",
			Host:       "localhost",
			OriginURL:  demoOriginURL(),
			DefaultTTL: time.Hour,
		},
	})

	handler := &proxy.CachingHandler{
		Zones:  zones,
		Origin: http.DefaultClient,
	}

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.NewHandler())
	mux.Handle("/", handler)

	log.Printf("edge-proxy listening on :%s (demo zone origin: %s)", port, demoOriginURL())
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func demoOriginURL() string {
	if u := os.Getenv("EDGE_PROXY_DEMO_ORIGIN_URL"); u != "" {
		return u
	}
	return "http://localhost:9999"
}
```

- [ ] **Step 6: Verify it builds**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go build -o /tmp/edge-proxy-typecheck/ ./...
cd ../..
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/edge-proxy/internal/proxy apps/edge-proxy/cmd/edge-proxy/main.go
git commit -m "feat: add edge-proxy bare reverse-proxy handler (Stage 3.1)"
```

---

### Task 6: Wire Redis as the L2 cache — Stage 3.2

**Files:**
- Create: `apps/edge-proxy/internal/proxy/handler_redis_integration_test.go`
- Modify: `apps/edge-proxy/cmd/edge-proxy/main.go`

**Interfaces:**
- Consumes: `cachestore.NewRedis` (Task 4), `proxy.CachingHandler` (Task 5, unmodified).
- Produces: nothing new — this task only adds a `cachestore.Layer` to an existing `Layers` slice, both in tests and in `main.go`.

- [ ] **Step 1: Ensure Redis is running, then write the failing integration tests**

```bash
docker compose -f infrastructure/compose/docker-compose.infra.yml up -d redis
```

`apps/edge-proxy/internal/proxy/handler_redis_integration_test.go`:

```go
//go:build integration

package proxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func newTestRedisLayer(t *testing.T) cachestore.Layer {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("invalid REDIS_URL %q: %v", url, err)
	}
	client := redis.NewClient(opts)
	t.Cleanup(func() { client.FlushDB(context.Background()); client.Close() })
	return cachestore.NewRedis(client, fmt.Sprintf("edge-proxy-test:%d:", time.Now().UnixNano()))
}

func TestCachingHandler_WithRedis_SecondRequestIsHitFromRedis(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "max-age=3600")
		w.Header().Set("ETag", "v1")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("cacheable body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/asset", nil)
		r.Host = "demo.test"
		return r
	}

	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, req())
	if got := rec1.Header().Get("X-RivoCloud-Cache"); got != "MISS" {
		t.Fatalf("expected first request to be MISS, got %q", got)
	}

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req())
	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected second request to be HIT, got %q", got)
	}
	body, _ := io.ReadAll(rec2.Body)
	if string(body) != "cacheable body" {
		t.Fatalf("unexpected body on cache hit: %q", body)
	}
	if hits != 1 {
		t.Fatalf("expected origin to be hit exactly once, got %d", hits)
	}
}

func TestCachingHandler_WithRedis_NoStoreIsNeverCached(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "no-store")
		w.Write([]byte("never cache me"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/private", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req())
	h.ServeHTTP(httptest.NewRecorder(), req())

	if hits != 2 {
		t.Fatalf("expected origin to be hit on every request for no-store content, got %d", hits)
	}
}

func TestCachingHandler_WithRedis_ExpiredEntryRevalidatesWith304(t *testing.T) {
	requestCount := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if r.Header.Get("If-None-Match") == "v1" {
			w.Header().Set("Cache-Control", "max-age=3600")
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Cache-Control", "max-age=0")
		w.Header().Set("ETag", "v1")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("original body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/revalidate-me", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req()) // first: stores with max-age=0 (always stale)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req()) // second: expired, revalidates, origin returns 304

	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected a 304-revalidated response to report HIT, got %q", got)
	}
	body, _ := io.ReadAll(rec2.Body)
	if string(body) != "original body" {
		t.Fatalf("expected the original cached body to be preserved across a 304, got %q", body)
	}
	if requestCount != 2 {
		t.Fatalf("expected exactly 2 origin requests (initial + revalidation), got %d", requestCount)
	}
}

type failingOriginFetcher struct{}

func (failingOriginFetcher) Do(req *http.Request) (*http.Response, error) {
	return nil, errors.New("connection refused")
}

func TestCachingHandler_WithRedis_ServesStaleOnOriginFailure(t *testing.T) {
	callCount := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Cache-Control", "max-age=0, stale-if-error=3600")
		w.Header().Set("ETag", "v1")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("stale-worthy body"))
	}))

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	redisLayer := newTestRedisLayer(t)
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{redisLayer}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/resilient", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req()) // populate cache, then take the origin down
	origin.Close()

	h.Origin = failingOriginFetcher{}
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req())

	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "STALE" {
		t.Fatalf("expected STALE when origin is unreachable but a stale-if-error entry exists, got %q (status %d)", got, rec2.Code)
	}
	body, _ := io.ReadAll(rec2.Body)
	if string(body) != "stale-worthy body" {
		t.Fatalf("unexpected stale body: %q", body)
	}
	if callCount != 1 {
		t.Fatalf("expected exactly 1 successful origin call before it was closed, got %d", callCount)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/proxy/... -run TestCachingHandler_WithRedis -v
cd ../..
```

Expected: FAIL to compile initially only if any symbol names drift — otherwise these tests exercise only Task 4/5 code and should already compile and pass once Task 5 is done, since `CachingHandler` already supports arbitrary `Layers`. Run first to confirm; this validates the "no rewrite needed" design claim before touching `main.go`.

- [ ] **Step 3: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/proxy/... -run TestCachingHandler_WithRedis -v
cd ../..
```

Expected: PASS (all 4 tests) — confirms `CachingHandler` needs no changes to support Redis; only `main.go`'s wiring changes next.

- [ ] **Step 4: Wire a real Redis client into `main.go`**

Replace the contents of `apps/edge-proxy/cmd/edge-proxy/main.go`:

```go
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/health"
	"rivocloud/edge-proxy/internal/proxy"
	"rivocloud/edge-proxy/internal/zone"
)

func main() {
	port := os.Getenv("EDGE_PROXY_PORT")
	if port == "" {
		port = "8888"
	}

	redisClient := mustConnectRedis()

	zones := zone.NewStaticRegistry([]zone.Config{
		{
			ID:         "demo",
			Host:       "localhost",
			OriginURL:  demoOriginURL(),
			DefaultTTL: time.Hour,
		},
	})

	handler := &proxy.CachingHandler{
		Zones:  zones,
		Layers: []cachestore.Layer{cachestore.NewRedis(redisClient, "edge-proxy:")},
		Origin: http.DefaultClient,
	}

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.NewHandler())
	mux.Handle("/", handler)

	log.Printf("edge-proxy listening on :%s (demo zone origin: %s)", port, demoOriginURL())
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func demoOriginURL() string {
	if u := os.Getenv("EDGE_PROXY_DEMO_ORIGIN_URL"); u != "" {
		return u
	}
	return "http://localhost:9999"
}

func mustConnectRedis() *redis.Client {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		log.Fatalf("invalid REDIS_URL %q: %v", url, err)
	}
	return redis.NewClient(opts)
}
```

- [ ] **Step 5: Verify it builds**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go build -o /tmp/edge-proxy-typecheck/ ./...
cd ../..
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-proxy/internal/proxy/handler_redis_integration_test.go apps/edge-proxy/cmd/edge-proxy/main.go apps/edge-proxy/go.mod apps/edge-proxy/go.sum
git commit -m "feat: wire Redis as the edge-proxy L2 cache (Stage 3.2)"
```

---

### Task 7: gzip compression variants

**Files:**
- Create: `apps/edge-proxy/internal/compress/compress.go`
- Create: `apps/edge-proxy/internal/compress/compress_test.go`
- Modify: `apps/edge-proxy/internal/proxy/handler.go`
- Create: `apps/edge-proxy/internal/proxy/handler_gzip_integration_test.go`

**Interfaces:**
- Consumes: `cachestore.Entry`/`Layer` (Task 4), `CachingHandler` internals (Task 5).
- Produces: `compress.IsCompressible(contentType string) bool`, `compress.AcceptsGzip(acceptEncoding string) bool`, `compress.Gzip(body []byte) ([]byte, error)`. `CachingHandler` gains one private helper, `gzipVariant`; its exported surface is unchanged.

- [ ] **Step 1: Write the failing compress package tests**

`apps/edge-proxy/internal/compress/compress_test.go`:

```go
package compress

import (
	"bytes"
	"compress/gzip"
	"io"
	"testing"
)

func TestIsCompressible_TextTypesAreCompressible(t *testing.T) {
	cases := []string{"text/html", "text/html; charset=utf-8", "application/json", "text/css"}
	for _, ct := range cases {
		if !IsCompressible(ct) {
			t.Errorf("expected %q to be compressible", ct)
		}
	}
}

func TestIsCompressible_BinaryTypesAreNotCompressible(t *testing.T) {
	cases := []string{"image/png", "video/mp4", "application/zip"}
	for _, ct := range cases {
		if IsCompressible(ct) {
			t.Errorf("expected %q to not be compressible", ct)
		}
	}
}

func TestAcceptsGzip_TrueWhenGzipListed(t *testing.T) {
	if !AcceptsGzip("gzip, deflate, br") {
		t.Fatal("expected gzip to be accepted")
	}
	if !AcceptsGzip("br, gzip;q=0.8") {
		t.Fatal("expected gzip with q-value to be accepted")
	}
}

func TestAcceptsGzip_FalseWhenNotListed(t *testing.T) {
	if AcceptsGzip("br, deflate") {
		t.Fatal("expected gzip to not be accepted")
	}
	if AcceptsGzip("") {
		t.Fatal("expected empty Accept-Encoding to not accept gzip")
	}
}

func TestGzip_ProducesValidGzipStream(t *testing.T) {
	compressed, err := Gzip([]byte("hello world"))
	if err != nil {
		t.Fatal(err)
	}
	r, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	decompressed, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if string(decompressed) != "hello world" {
		t.Fatalf("expected round-trip to preserve content, got %q", decompressed)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/compress/... -v
cd ../..
```

Expected: FAIL — `undefined: IsCompressible` / `AcceptsGzip` / `Gzip`.

- [ ] **Step 3: Implement the compress package**

`apps/edge-proxy/internal/compress/compress.go`:

```go
package compress

import (
	"bytes"
	"compress/gzip"
	"strings"
)

// Compressible content types, per EDD Section 5.7. Brotli is intentionally
// not implemented this stage (Month 2 task list: "gzip compression (skip
// brotli until Month 4)").
var compressibleTypes = map[string]bool{
	"text/html":              true,
	"text/css":                true,
	"text/plain":              true,
	"application/javascript":  true,
	"application/json":        true,
	"application/xml":         true,
}

func IsCompressible(contentType string) bool {
	ct := contentType
	if i := strings.IndexByte(ct, ';'); i != -1 {
		ct = ct[:i]
	}
	return compressibleTypes[strings.ToLower(strings.TrimSpace(ct))]
}

func AcceptsGzip(acceptEncoding string) bool {
	for _, enc := range strings.Split(acceptEncoding, ",") {
		enc = strings.TrimSpace(enc)
		if i := strings.IndexByte(enc, ';'); i != -1 {
			enc = enc[:i]
		}
		if strings.EqualFold(strings.TrimSpace(enc), "gzip") {
			return true
		}
	}
	return false
}

func Gzip(body []byte) ([]byte, error) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	if _, err := gw.Write(body); err != nil {
		return nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test ./internal/compress/... -v
cd ../..
```

Expected: PASS.

- [ ] **Step 5: Write the failing gzip integration test for the handler**

`apps/edge-proxy/internal/proxy/handler_gzip_integration_test.go`:

```go
//go:build integration

package proxy

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func TestCachingHandler_ServesGzipVariantWhenAccepted(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html>compressible</html>"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/page.html", nil)
	req.Host = "demo.test"
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("expected Content-Encoding: gzip, got %q", got)
	}
	gr, err := gzip.NewReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("expected body to be valid gzip: %v", err)
	}
	defer gr.Close()
	decompressed, _ := io.ReadAll(gr)
	if string(decompressed) != "<html>compressible</html>" {
		t.Fatalf("unexpected decompressed body: %q", decompressed)
	}
}

func TestCachingHandler_ServesIdentityWhenGzipNotAccepted(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html>compressible</html>"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/page.html", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("expected no Content-Encoding without Accept-Encoding: gzip, got %q", got)
	}
	body, _ := io.ReadAll(rec.Body)
	if string(body) != "<html>compressible</html>" {
		t.Fatalf("unexpected body: %q", body)
	}
}

func TestCachingHandler_NeverCompressesBinaryContent(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("\x89PNGnotreallyapngbutclosenough"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/photo.png", nil)
	req.Host = "demo.test"
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("expected image content to never be gzip-compressed, got Content-Encoding %q", got)
	}
}
```

- [ ] **Step 6: Run to verify it fails**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/proxy/... -run TestCachingHandler_.*Gzip -v
cd ../..
```

Expected: FAIL — no `Content-Encoding` header is ever set yet (gzip negotiation doesn't exist in the handler).

- [ ] **Step 7: Add gzip negotiation to the handler**

In `apps/edge-proxy/internal/proxy/handler.go`, add `"rivocloud/edge-proxy/internal/compress"` to the imports, and insert the negotiation step into `ServeHTTP` right before each of its FOUR `writeEntry(...)` calls that serve a GET/HEAD response (the `found && entry.Fresh(now)` branch, the STALE-on-origin-failure branch, the `result.notModified` branch, and the final fresh-fetch branch) — replace each of those four blocks' entry variable with the negotiated one. A client that asked for gzip should get gzip on a stale-served response too, not just on a normal hit/miss — otherwise the encoding of what's served becomes inconsistent depending on whether the origin happened to be reachable. Concretely, change:

```go
	if found && entry.Fresh(now) {
		h.populateFasterLayers(r.Context(), key, entry, hitLayerIdx)
		writeEntry(w, r, entry, now, "HIT")
		return
	}
```

to:

```go
	if found && entry.Fresh(now) {
		h.populateFasterLayers(r.Context(), key, entry, hitLayerIdx)
		writeEntry(w, r, h.negotiateEncoding(r, key, entry), now, "HIT")
		return
	}
```

change:

```go
		if found && entry.UsableAsStale(now) {
			writeEntry(w, r, entry, now, "STALE")
			return
		}
```

to:

```go
		if found && entry.UsableAsStale(now) {
			writeEntry(w, r, h.negotiateEncoding(r, key, entry), now, "STALE")
			return
		}
```

change:

```go
	if result.notModified {
		refreshed := refreshExpiry(entry, result.decision, now)
		h.store(r.Context(), key, refreshed)
		writeEntry(w, r, refreshed, now, "HIT")
		return
	}
```

to:

```go
	if result.notModified {
		refreshed := refreshExpiry(entry, result.decision, now)
		h.store(r.Context(), key, refreshed)
		writeEntry(w, r, h.negotiateEncoding(r, key, refreshed), now, "HIT")
		return
	}
```

and change:

```go
	newEntry := buildEntry(result.response, body, result.decision, now)
	if result.decision.Cacheable {
		h.store(r.Context(), key, newEntry)
	}
	writeEntry(w, r, newEntry, now, "MISS")
```

to:

```go
	newEntry := buildEntry(result.response, body, result.decision, now)
	if result.decision.Cacheable {
		h.store(r.Context(), key, newEntry)
	}
	writeEntry(w, r, h.negotiateEncoding(r, key, newEntry), now, "MISS")
```

Also change `fetchOrigin` — the client's own `Accept-Encoding` header must never reach the origin unmodified, or a gzip-aware origin could hand back an already-gzip-compressed body that `negotiateEncoding` would then compress a second time, corrupting it for every client that requests it. Change:

```go
	outReq := r.Clone(r.Context())
	outReq.URL.Scheme = target.Scheme
	outReq.URL.Host = target.Host
	outReq.URL.Path = r.URL.Path
	outReq.Host = target.Host
	outReq.RequestURI = ""
	if etag != "" {
		outReq.Header.Set("If-None-Match", etag)
	}
```

to:

```go
	outReq := r.Clone(r.Context())
	outReq.URL.Scheme = target.Scheme
	outReq.URL.Host = target.Host
	outReq.URL.Path = r.URL.Path
	outReq.Host = target.Host
	outReq.RequestURI = ""
	// With no Accept-Encoding header at all, Go's http.Transport adds its
	// own "Accept-Encoding: gzip" and transparently decompresses the
	// response (stripping Content-Encoding/Content-Length before we ever
	// see them) — forwarding the client's own header verbatim disables
	// that and risks caching an already-compressed body as "identity".
	outReq.Header.Del("Accept-Encoding")
	if etag != "" {
		outReq.Header.Set("If-None-Match", etag)
	}
```

Then add these two functions at the bottom of the file:

```go
func (h *CachingHandler) negotiateEncoding(r *http.Request, baseKey string, identity cachestore.Entry) cachestore.Entry {
	if !identity.Cacheable {
		return identity
	}
	if !compress.AcceptsGzip(r.Header.Get("Accept-Encoding")) {
		return identity
	}
	if !compress.IsCompressible(identity.Header.Get("Content-Type")) {
		return identity
	}
	return h.gzipVariant(r.Context(), baseKey, identity)
}

func (h *CachingHandler) gzipVariant(ctx context.Context, baseKey string, identity cachestore.Entry) cachestore.Entry {
	gzKey := baseKey + ":gz"
	if cached, _, ok := h.lookup(ctx, gzKey); ok && cached.Fresh(h.now()) {
		return cached
	}

	compressed, err := compress.Gzip(identity.Body)
	if err != nil {
		log.Printf("gzip compress error: %v", err)
		return identity
	}

	variant := identity
	variant.Header = identity.Header.Clone()
	variant.Header.Set("Content-Encoding", "gzip")
	variant.Header.Set("Content-Length", strconv.Itoa(len(compressed)))
	variant.Body = compressed

	h.store(ctx, gzKey, variant)
	return variant
}
```

- [ ] **Step 8: Run to verify it passes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/proxy/... -v
cd ../..
```

Expected: PASS — every test from Tasks 5, 6, and 7 (gzip tests included) still passes.

- [ ] **Step 9: Commit**

```bash
git add apps/edge-proxy/internal/compress apps/edge-proxy/internal/proxy
git commit -m "feat: add gzip compression variants to edge-proxy cache (EDD 5.7)"
```

---

### Task 8: Wire the in-process LRU as L1 — Stage 3.3

**Files:**
- Create: `apps/edge-proxy/internal/proxy/handler_l1_integration_test.go`
- Modify: `apps/edge-proxy/cmd/edge-proxy/main.go`

**Interfaces:**
- Consumes: `cachestore.NewMemory` (Task 4), `CachingHandler` (unmodified).
- Produces: nothing new — confirms the layered design from Task 5 needs zero handler changes to add L1, then wires it into `main.go`.

- [ ] **Step 1: Write the failing integration test proving L1 avoids a Redis round-trip**

`apps/edge-proxy/internal/proxy/handler_l1_integration_test.go`:

```go
//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func TestCachingHandler_WithL1AndL2_ThirdRequestHitsL1WithoutRedis(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("layered body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	redisLayer := newTestRedisLayer(t)
	memory, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	h := &CachingHandler{
		Zones:  zones,
		Layers: []cachestore.Layer{memory, redisLayer},
		Origin: http.DefaultClient,
	}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/hot-asset", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req()) // MISS: fetched from origin, stored in L1+L2
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req()) // HIT from L1 (populated by the first request)
	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected second request to HIT, got %q", got)
	}

	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req())
	if got := rec3.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected third request to HIT from L1, got %q", got)
	}
	if hits != 1 {
		t.Fatalf("expected origin to be hit exactly once across all three requests, got %d", hits)
	}
}

func TestCachingHandler_WithL1AndL2_DifferentHandlerInstanceMissesL1ButHitsL2(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("shared across replicas"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	sharedRedis := newTestRedisLayer(t)

	memoryA, _ := cachestore.NewMemory(100)
	replicaA := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memoryA, sharedRedis}, Origin: http.DefaultClient}

	memoryB, _ := cachestore.NewMemory(100)
	replicaB := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memoryB, sharedRedis}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/pop-shared-asset", nil)
		r.Host = "demo.test"
		return r
	}

	replicaA.ServeHTTP(httptest.NewRecorder(), req()) // replica A: MISS, populates its L1 + shared L2

	recB := httptest.NewRecorder()
	replicaB.ServeHTTP(recB, req()) // replica B: L1 miss (its own, empty), but L2 hit
	if got := recB.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected replica B to HIT via the shared L2, got %q", got)
	}
	if hits != 1 {
		t.Fatalf("expected origin to be hit exactly once across both replicas, got %d", hits)
	}
}
```

- [ ] **Step 2: Run to verify it passes without any handler changes**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go test -tags=integration ./internal/proxy/... -run TestCachingHandler_WithL1AndL2 -v
cd ../..
```

Expected: PASS immediately — confirms `CachingHandler` supports L1+L2 through its existing `Layers` slice with no code changes, exactly as Task 5's design intended.

- [ ] **Step 3: Wire the in-process LRU into `main.go`**

Replace the contents of `apps/edge-proxy/cmd/edge-proxy/main.go`:

```go
package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/health"
	"rivocloud/edge-proxy/internal/proxy"
	"rivocloud/edge-proxy/internal/zone"
)

func main() {
	port := os.Getenv("EDGE_PROXY_PORT")
	if port == "" {
		port = "8888"
	}

	redisClient := mustConnectRedis()
	memory, err := cachestore.NewMemory(l1MaxEntries())
	if err != nil {
		log.Fatalf("failed to create L1 cache: %v", err)
	}

	zones := zone.NewStaticRegistry([]zone.Config{
		{
			ID:         "demo",
			Host:       "localhost",
			OriginURL:  demoOriginURL(),
			DefaultTTL: time.Hour,
		},
	})

	handler := &proxy.CachingHandler{
		Zones: zones,
		Layers: []cachestore.Layer{
			memory,
			cachestore.NewRedis(redisClient, "edge-proxy:"),
		},
		Origin: http.DefaultClient,
	}

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.NewHandler())
	mux.Handle("/", handler)

	log.Printf("edge-proxy listening on :%s (demo zone origin: %s)", port, demoOriginURL())
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func demoOriginURL() string {
	if u := os.Getenv("EDGE_PROXY_DEMO_ORIGIN_URL"); u != "" {
		return u
	}
	return "http://localhost:9999"
}

func l1MaxEntries() int {
	if raw := os.Getenv("EDGE_PROXY_L1_MAX_ENTRIES"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return n
		}
	}
	return 10_000
}

func mustConnectRedis() *redis.Client {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		log.Fatalf("invalid REDIS_URL %q: %v", url, err)
	}
	return redis.NewClient(opts)
}
```

- [ ] **Step 4: Verify it builds**

```bash
cd apps/edge-proxy
bash scripts/go-docker.sh go build -o /tmp/edge-proxy-typecheck/ ./...
cd ../..
```

Expected: exits 0.

- [ ] **Step 5: Append the L1 tuning env var to `.env.example`**

Update the Edge Proxy section added in Task 1 to:

```
# Edge Proxy
EDGE_PROXY_PORT=8888
EDGE_PROXY_L1_MAX_ENTRIES=10000
```

- [ ] **Step 6: Commit**

```bash
git add apps/edge-proxy/internal/proxy/handler_l1_integration_test.go apps/edge-proxy/cmd/edge-proxy/main.go .env.example
git commit -m "feat: wire in-process LRU as the edge-proxy L1 cache (Stage 3.3)"
```

---

### Task 9: CI wiring, PRD update, and manual end-to-end verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: a CI pipeline that lints/typechecks/tests `apps/edge-proxy` on every PR, and a PRD marked with Stage 3 done — closing out this plan the same way Stage 2's final commit did.

- [ ] **Step 1: Add a Go toolchain setup step to every CI job that runs turbo tasks**

In `.github/workflows/ci.yml`, add this step immediately after each job's `actions/setup-node@v4` step, in `lint-and-typecheck`, `test-unit`, and `test-integration`:

```yaml
      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'
          cache-dependency-path: apps/edge-proxy/go.sum
```

- [ ] **Step 2: Point CI's Go tasks at the native toolchain, not the Docker wrapper**

CI has a native Go toolchain (unlike this dev machine), so its `pnpm turbo` invocations must not go through `scripts/go-docker.sh`. Add a `CI` environment check to `apps/edge-proxy/scripts/go-docker.sh` so it degrades to running `go` directly when `$CI` is set (GitHub Actions sets this automatically):

Modify `apps/edge-proxy/scripts/go-docker.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ -n "${CI:-}" ]; then
  # GitHub Actions runners have a native Go toolchain (actions/setup-go) —
  # skip Docker entirely there. The Docker wrapper below only exists to work
  # around this dev machine having no native Go toolchain.
  exec "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
WIN_REPO_ROOT="$(cygpath -w "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")"

rewrite_localhost() {
  local value="${1:-}"
  value="${value/127.0.0.1/host.docker.internal}"
  value="${value/localhost/host.docker.internal}"
  echo "$value"
}

CONTAINER_REDIS_URL="$(rewrite_localhost "${REDIS_URL:-redis://localhost:6379}")"
CONTAINER_ORIGIN_URL="$(rewrite_localhost "${EDGE_PROXY_DEMO_ORIGIN_URL:-http://localhost:9999}")"
CONTAINER_PORT="${EDGE_PROXY_PORT:-8888}"

DOCKER_ARGS=(
  --rm
  -v "${WIN_REPO_ROOT}://workspace"
  -w "//workspace/apps/edge-proxy"
  -e CGO_ENABLED=0
  -e GOFLAGS=-mod=mod
  -e REDIS_URL="${CONTAINER_REDIS_URL}"
  -e EDGE_PROXY_PORT="${CONTAINER_PORT}"
  -e EDGE_PROXY_DEMO_ORIGIN_URL="${CONTAINER_ORIGIN_URL}"
  -e EDGE_PROXY_L1_MAX_ENTRIES="${EDGE_PROXY_L1_MAX_ENTRIES:-}"
)

if [ "${1:-}" = "go" ] && [ "${2:-}" = "run" ]; then
  DOCKER_ARGS+=(-p "${CONTAINER_PORT}:${CONTAINER_PORT}")
fi

docker run "${DOCKER_ARGS[@]}" golang:1.23-alpine "$@"
```

Note: on the native-Go path, `exec "$@"` runs relative to the CI job's current working directory — turbo already sets that to `apps/edge-proxy` for this package's scripts, matching the Docker path's `-w //workspace/apps/edge-proxy`.

- [ ] **Step 3: Run the full local verification one more time to confirm the CI-check branch didn't break local dev**

```bash
pnpm turbo lint typecheck test:unit --filter=@rivocloud/edge-proxy
REDIS_URL=redis://localhost:6379 pnpm turbo test:integration --filter=@rivocloud/edge-proxy
```

Expected: all pass, still routed through Docker (since `$CI` is unset locally).

- [ ] **Step 4: Update the PRD to mark Stage 3 done**

In `docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md`:

Change the roadmap table row:
```
| 3 | Go Edge Proxy (Basic) — HTTP server, Redis (L2), in-process LRU (L1) | 2 | Not started | 1 | [`edge-proxy-and-caching.md`](../../concepts/edge-proxy-and-caching.md) |
```
to:
```
| 3 | Go Edge Proxy (Basic) — HTTP server, Redis (L2), in-process LRU (L1) | 2 | ✅ Done | 1 | [`edge-proxy-and-caching.md`](../../concepts/edge-proxy-and-caching.md) |
```

And change the **Status** line at the top of the document:
```
**Status:** Draft — Stages 1-2 (Infrastructure Foundation, Identity Service) complete, Stages 3–16 not started.
```
to:
```
**Status:** Draft — Stages 1-3 (Infrastructure Foundation, Identity Service, Go Edge Proxy) complete, Stages 4–16 not started.
```

- [ ] **Step 5: Manual end-to-end verification of the Month 2 deliverable**

Start the infra, a trivial local origin, and the edge proxy itself, then verify a miss followed by a hit:

```bash
docker compose -f infrastructure/compose/docker-compose.infra.yml up -d redis
python -m http.server 9999 --directory . &
cd apps/edge-proxy
bash scripts/go-docker.sh go run ./cmd/edge-proxy &
cd ../..
sleep 2

curl -s -D - -H "Host: localhost" http://localhost:8888/README.md -o /dev/null | grep -i "X-RivoCloud-Cache"
curl -s -D - -H "Host: localhost" http://localhost:8888/README.md -o /dev/null | grep -i "X-RivoCloud-Cache"
```

Expected: the first `curl` prints `X-RivoCloud-Cache: MISS`, the second prints `X-RivoCloud-Cache: HIT` — matching the PRD's Month 2 deliverable ("a request to an uncached path is a cache miss; the same request seconds later is a cache hit"). Stop the background processes afterward (`kill %1 %2` or close the terminal).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml docs/superpowers/specs/2026-07-25-revocloud-phase1-prd.md apps/edge-proxy/scripts/go-docker.sh
git commit -m "ci: wire edge-proxy into CI and mark Stage 3 done in the PRD"
```
