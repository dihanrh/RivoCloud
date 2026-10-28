package zone

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"rivocloud/edge-proxy/internal/cacherules"
)

// redisConfig mirrors the JSON the CDN Service writes to zone_config:{id}
// (docs/concepts/cdn-zones-and-configuration.md Section 4).
type redisConfig struct {
	ID             string `json:"id"`
	Slug           string `json:"slug"`
	OrgID          string `json:"orgId"`
	OriginURL      string `json:"originUrl"`
	OriginProtocol string `json:"originProtocol"`
	CacheTTL       int    `json:"cacheTtl"`
	BrowserTTL     int    `json:"browserTtl"`
	Enabled        bool   `json:"enabled"`
	// Only present while signedUrlsRequired is true — see the CDN Service's
	// ZoneConfigPublisher.
	SignedURLsRequired bool   `json:"signedUrlsRequired"`
	SigningSecret      string `json:"signingSecret"`
}

// redisRule mirrors one element of the JSON array the CDN Service writes to
// zone_rules:{zoneId} (apps/cdn-service/src/rules/rules-config.publisher.ts).
type redisRule struct {
	Pattern        string   `json:"pattern"`
	PatternType    string   `json:"patternType"`
	Action         string   `json:"action"`
	EdgeTTL        *int     `json:"edgeTtl"`
	BrowserTTL     *int     `json:"browserTtl"`
	QueryString    string   `json:"queryString"`
	QueryWhitelist []string `json:"queryWhitelist"`
	Priority       int      `json:"priority"`
}

type hostEntry struct {
	zoneID    string
	found     bool
	expiresAt time.Time
}

type configEntry struct {
	cfg       Config
	found     bool
	expiresAt time.Time
}

// RedisRegistry resolves a Host header to a zone Config by reading the
// zone_host:{host} -> zone_config:{id} pair the CDN Service publishes
// (concept doc Section 4/5). Two independent 60s in-process caches sit in
// front of Redis — host->zoneID and zoneID->config — so the hot path never
// pays a Redis round-trip on every request, and a config.zones.updated NATS
// nudge (Task 8) can evict exactly the zone that changed by ID, without
// needing to know which host(s) map to it.
type RedisRegistry struct {
	client *redis.Client
	ttl    time.Duration

	// negativeTTL bounds how long a "host not found" result stays cached.
	// It's kept much shorter than ttl so a host queried just before its
	// zone is created doesn't stay stuck as not-found for up to 60s.
	negativeTTL time.Duration

	mu           sync.RWMutex
	hostToZoneID map[string]hostEntry
	zoneConfig   map[string]configEntry
}

func NewRedisRegistry(client *redis.Client) *RedisRegistry {
	return &RedisRegistry{
		client:       client,
		ttl:          60 * time.Second,
		negativeTTL:  2 * time.Second,
		hostToZoneID: make(map[string]hostEntry),
		zoneConfig:   make(map[string]configEntry),
	}
}

func (r *RedisRegistry) Resolve(host string) (Config, bool) {
	host = normalizeHost(host)

	zoneID, found := r.resolveZoneID(host)
	if !found {
		return Config{}, false
	}
	return r.resolveConfig(zoneID)
}

// EvictZone drops a zone's cached config so the next request re-reads Redis
// — called by the configsync NATS subscriber (Task 8) on a
// config.zones.updated nudge.
func (r *RedisRegistry) EvictZone(zoneID string) {
	r.mu.Lock()
	delete(r.zoneConfig, zoneID)
	r.mu.Unlock()
}

func (r *RedisRegistry) resolveZoneID(host string) (string, bool) {
	r.mu.RLock()
	entry, ok := r.hostToZoneID[host]
	r.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.zoneID, entry.found
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	zoneID, err := r.client.Get(ctx, "zone_host:"+host).Result()
	found := err == nil
	if err != nil && !errors.Is(err, redis.Nil) {
		log.Printf("zone: zone_host lookup error for %q: %v", host, err)
	}

	expiry := r.ttl
	if !found {
		expiry = r.negativeTTL
	}
	r.mu.Lock()
	r.hostToZoneID[host] = hostEntry{zoneID: zoneID, found: found, expiresAt: time.Now().Add(expiry)}
	r.mu.Unlock()
	return zoneID, found
}

func (r *RedisRegistry) resolveConfig(zoneID string) (Config, bool) {
	r.mu.RLock()
	entry, ok := r.zoneConfig[zoneID]
	r.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.cfg, entry.found
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	raw, err := r.client.Get(ctx, "zone_config:"+zoneID).Result()

	var cfg Config
	found := false
	ttl := r.ttl
	switch {
	case err == nil:
		var rc redisConfig
		if jsonErr := json.Unmarshal([]byte(raw), &rc); jsonErr != nil {
			log.Printf("zone: bad zone_config JSON for %q: %v", zoneID, jsonErr)
		} else if rc.Enabled {
			cfg = Config{
				ID:                 rc.ID,
				OrgID:              rc.OrgID,
				OriginURL:          rc.OriginURL,
				DefaultTTL:         time.Duration(rc.CacheTTL) * time.Second,
				SignedURLsRequired: rc.SignedURLsRequired,
				SigningSecret:      rc.SigningSecret,
			}
			rules, rulesOK := r.resolveRules(ctx, zoneID)
			cfg.Rules = rules
			if !rulesOK {
				// The rules read itself failed (as opposed to "genuinely no
				// rules configured") — memoizing this rule-less config for
				// the full 60s ttl would silently disable bypass/TTL-override
				// rules until it expires. Use the short negativeTTL instead
				// so a transient Redis blip gets retried within ~2s.
				ttl = r.negativeTTL
			}
			found = true
		}
	case !errors.Is(err, redis.Nil):
		log.Printf("zone: zone_config lookup error for %q: %v", zoneID, err)
	}

	r.mu.Lock()
	r.zoneConfig[zoneID] = configEntry{cfg: cfg, found: found, expiresAt: time.Now().Add(ttl)}
	r.mu.Unlock()
	return cfg, found
}

// resolveRules reads zone_rules:{zoneID} (written by the CDN Service's
// RulesConfigPublisher on every rule mutation) and returns them pre-sorted
// highest-priority-first. The second return value distinguishes "genuinely
// no rules configured" (redis.Nil, ok=true — safe to cache for the full
// registry TTL) from "the read itself failed" (ok=false) — resolveConfig
// uses this to avoid memoizing a rule-less config for the full TTL when a
// transient Redis error is the actual cause, which would otherwise silently
// disable bypass/TTL-override rules until the cache entry expires.
func (r *RedisRegistry) resolveRules(ctx context.Context, zoneID string) (rules []cacherules.Rule, ok bool) {
	raw, err := r.client.Get(ctx, "zone_rules:"+zoneID).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, true
		}
		log.Printf("zone: zone_rules lookup error for %q: %v", zoneID, err)
		return nil, false
	}
	var parsed []redisRule
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		log.Printf("zone: bad zone_rules JSON for %q: %v", zoneID, err)
		return nil, false
	}
	parsedRules := make([]cacherules.Rule, len(parsed))
	for i, p := range parsed {
		parsedRules[i] = cacherules.Rule{
			Pattern:        p.Pattern,
			PatternType:    p.PatternType,
			Action:         p.Action,
			EdgeTTL:        p.EdgeTTL,
			BrowserTTL:     p.BrowserTTL,
			QueryString:    p.QueryString,
			QueryWhitelist: p.QueryWhitelist,
			Priority:       p.Priority,
		}
	}
	return cacherules.SortByPriorityDesc(parsedRules), true
}
