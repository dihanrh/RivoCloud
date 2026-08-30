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

	// ZoneID and Path identify what this entry actually is, in plain text —
	// unlike the SHA-256 cache key, which is one-way. Populated at write
	// time (internal/proxy/handler.go) so a purge operation (Task 9) can
	// glob-match a pattern against Path without needing a separate index,
	// matching the EDD's own flow diagram ("SCAN Redis for matching keys").
	ZoneID string
	Path   string
	// Tags supports invalidation-by-tag (EDD Section 4.4's tags[] field).
	// Populated from an origin response's Cache-Tag header, if present — see
	// the plan's Design Decisions #1 for why this convention exists.
	Tags []string
	// BrowserTTL, when set, overrides the browser-facing Cache-Control
	// max-age independent of ExpiresAt (a matched cache rule's browserTtl,
	// EDD Section 6.2). Nil means "use the remaining edge TTL," today's
	// only behavior.
	BrowserTTL *time.Duration
}

func (e Entry) Fresh(now time.Time) bool {
	return now.Before(e.ExpiresAt)
}

func (e Entry) UsableAsStale(now time.Time) bool {
	return now.Before(e.StaleUntil)
}
