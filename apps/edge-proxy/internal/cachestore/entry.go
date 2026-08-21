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
