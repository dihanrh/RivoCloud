package zone

import (
	"strings"
	"time"
)

// Config describes one CDN zone: which inbound Host header it matches and
// which origin server requests are forwarded to. Stage 3 hardcoded these in
// main.go; Stage 4's zone.RedisRegistry now resolves them from Redis
// instead. Host is populated by StaticRegistry for its own lookup; a
// Config returned by RedisRegistry leaves it empty, since nothing
// downstream reads Host off an already-resolved Config.
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
