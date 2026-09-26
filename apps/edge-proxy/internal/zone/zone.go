package zone

import (
	"strings"
	"time"

	"rivocloud/edge-proxy/internal/cacherules"
)

// Config describes one CDN zone: which inbound Host header it matches and
// which origin server requests are forwarded to. Stage 3 hardcoded these in
// main.go; Stage 4's zone.RedisRegistry now resolves them from Redis
// instead. Host is populated by StaticRegistry for its own lookup; a
// Config returned by RedisRegistry leaves it empty, since nothing
// downstream reads Host off an already-resolved Config.
type Config struct {
	ID   string
	Host string
	// OrgID is the owning organization, read from zone_config:{id}'s
	// "orgId" field (written by the CDN Service's ZoneConfigPublisher).
	// Empty for a Config built by StaticRegistry.
	OrgID      string
	OriginURL  string
	DefaultTTL time.Duration
	// Rules is this zone's cache rules, pre-sorted highest-priority-first
	// (Stage 7), read from zone_rules:{ID} in Redis. Empty for a zone with
	// no rules configured, or for a Config built by StaticRegistry.
	Rules []cacherules.Rule
	// SignedURLsRequired makes the edge reject any request without a valid
	// expires/sig pair (Stage 10, EDD Section 5.5). SigningSecret is the raw
	// HMAC key the CDN Service publishes alongside it; a zone that requires
	// signatures with an empty secret fails closed.
	SignedURLsRequired bool
	SigningSecret      string
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
