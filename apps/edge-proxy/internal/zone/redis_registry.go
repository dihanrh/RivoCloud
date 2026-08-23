package zone

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// redisConfig mirrors the JSON the CDN Service writes to zone_config:{id}
// (docs/concepts/cdn-zones-and-configuration.md Section 4).
type redisConfig struct {
	ID             string `json:"id"`
	Slug           string `json:"slug"`
	OriginURL      string `json:"originUrl"`
	OriginProtocol string `json:"originProtocol"`
	CacheTTL       int    `json:"cacheTtl"`
	BrowserTTL     int    `json:"browserTtl"`
	Enabled        bool   `json:"enabled"`
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
	switch {
	case err == nil:
		var rc redisConfig
		if jsonErr := json.Unmarshal([]byte(raw), &rc); jsonErr != nil {
			log.Printf("zone: bad zone_config JSON for %q: %v", zoneID, jsonErr)
		} else if rc.Enabled {
			cfg = Config{ID: rc.ID, OriginURL: rc.OriginURL, DefaultTTL: time.Duration(rc.CacheTTL) * time.Second}
			found = true
		}
	case !errors.Is(err, redis.Nil):
		log.Printf("zone: zone_config lookup error for %q: %v", zoneID, err)
	}

	r.mu.Lock()
	r.zoneConfig[zoneID] = configEntry{cfg: cfg, found: found, expiresAt: time.Now().Add(r.ttl)}
	r.mu.Unlock()
	return cfg, found
}
