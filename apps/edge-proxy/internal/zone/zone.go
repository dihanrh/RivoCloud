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
