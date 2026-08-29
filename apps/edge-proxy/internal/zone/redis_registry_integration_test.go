//go:build integration

package zone

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func newTestRedisClient(t *testing.T) *redis.Client {
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
	return client
}

func seedZoneConfig(t *testing.T, client *redis.Client, host, zoneID string, cfg redisConfig) {
	t.Helper()
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := client.Set(ctx, "zone_host:"+host, zoneID, 0).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.Set(ctx, "zone_config:"+zoneID, raw, 0).Err(); err != nil {
		t.Fatal(err)
	}
}

func TestRedisRegistry_ResolvesAHostPublishedByTheCDNService(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "my-blog.cdn.rivocloud.dev", "zone-1", redisConfig{
		ID: "zone-1", Slug: "my-blog", OriginURL: "https://api.example.com",
		OriginProtocol: "https", CacheTTL: 3600, Enabled: true,
	})

	registry := NewRedisRegistry(client)
	cfg, ok := registry.Resolve("my-blog.cdn.rivocloud.dev:8888")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if cfg.ID != "zone-1" || cfg.OriginURL != "https://api.example.com" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if cfg.DefaultTTL != 3600*time.Second {
		t.Fatalf("expected DefaultTTL 3600s, got %s", cfg.DefaultTTL)
	}
}

func TestRedisRegistry_UnknownHostNotFound(t *testing.T) {
	client := newTestRedisClient(t)
	registry := NewRedisRegistry(client)

	_, ok := registry.Resolve("nobody.cdn.rivocloud.dev")
	if ok {
		t.Fatal("expected unknown host to not resolve")
	}
}

func TestRedisRegistry_DisabledZoneNotFound(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "disabled.cdn.rivocloud.dev", "zone-2", redisConfig{
		ID: "zone-2", Slug: "disabled", OriginURL: "https://api.example.com", Enabled: false,
	})

	registry := NewRedisRegistry(client)
	_, ok := registry.Resolve("disabled.cdn.rivocloud.dev")
	if ok {
		t.Fatal("expected a disabled zone to not resolve")
	}
}

func TestRedisRegistry_CachesForSixtySecondsThenRereadsRedisOnEvict(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "cached.cdn.rivocloud.dev", "zone-3", redisConfig{
		ID: "zone-3", Slug: "cached", OriginURL: "https://old.example.com", CacheTTL: 60, Enabled: true,
	})

	registry := NewRedisRegistry(client)
	first, ok := registry.Resolve("cached.cdn.rivocloud.dev")
	if !ok || first.OriginURL != "https://old.example.com" {
		t.Fatalf("expected first resolve to see the seeded origin, got %+v ok=%v", first, ok)
	}

	seedZoneConfig(t, client, "cached.cdn.rivocloud.dev", "zone-3", redisConfig{
		ID: "zone-3", Slug: "cached", OriginURL: "https://new.example.com", CacheTTL: 60, Enabled: true,
	})
	second, _ := registry.Resolve("cached.cdn.rivocloud.dev")
	if second.OriginURL != "https://old.example.com" {
		t.Fatalf("expected the 60s in-process cache to still serve the old origin, got %s", second.OriginURL)
	}

	registry.EvictZone("zone-3")
	third, ok := registry.Resolve("cached.cdn.rivocloud.dev")
	if !ok || third.OriginURL != "https://new.example.com" {
		t.Fatalf("expected EvictZone to force a re-read, got %+v ok=%v", third, ok)
	}
}

func TestRedisRegistry_NegativeLookupExpiresQuicklyThenFindsANewlyPublishedZone(t *testing.T) {
	client := newTestRedisClient(t)
	// A prior run of this same test (or the seed below) may have left this
	// key behind with no TTL — clear it so the "unknown host" premise holds.
	if err := client.Del(context.Background(), "zone_host:brand-new.cdn.rivocloud.dev").Err(); err != nil {
		t.Fatal(err)
	}
	registry := NewRedisRegistry(client)

	_, ok := registry.Resolve("brand-new.cdn.rivocloud.dev")
	if ok {
		t.Fatal("expected unpublished host to not resolve")
	}

	time.Sleep(2100 * time.Millisecond)

	seedZoneConfig(t, client, "brand-new.cdn.rivocloud.dev", "zone-4", redisConfig{
		ID: "zone-4", Slug: "brand-new", OriginURL: "https://fresh.example.com", CacheTTL: 60, Enabled: true,
	})

	cfg, ok := registry.Resolve("brand-new.cdn.rivocloud.dev")
	if !ok {
		t.Fatal("expected the negative cache entry to have expired, allowing the newly published zone to resolve")
	}
	if cfg.OriginURL != "https://fresh.example.com" {
		t.Fatalf("unexpected config after negative cache expiry: %+v", cfg)
	}
}

func TestRedisRegistry_ResolvesRulesSortedByPriorityDescending(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "rules.cdn.rivocloud.dev", "zone-rules-1", redisConfig{
		ID: "zone-rules-1", Slug: "rules", OriginURL: "https://api.example.com", CacheTTL: 3600, Enabled: true,
	})
	rulesJSON := `[
		{"pattern":"/assets/*","patternType":"glob","action":"cache","edgeTtl":604800,"priority":1},
		{"pattern":"/api/*","patternType":"glob","action":"bypass","edgeTtl":0,"priority":10}
	]`
	if err := client.Set(context.Background(), "zone_rules:zone-rules-1", rulesJSON, 0).Err(); err != nil {
		t.Fatal(err)
	}

	registry := NewRedisRegistry(client)
	cfg, ok := registry.Resolve("rules.cdn.rivocloud.dev")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if len(cfg.Rules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(cfg.Rules))
	}
	if cfg.Rules[0].Pattern != "/api/*" || cfg.Rules[0].Priority != 10 {
		t.Fatalf("expected the priority-10 rule first, got %+v", cfg.Rules[0])
	}
}

func TestRedisRegistry_MissingRulesKeyResolvesWithNoRules(t *testing.T) {
	client := newTestRedisClient(t)
	seedZoneConfig(t, client, "norules.cdn.rivocloud.dev", "zone-no-rules", redisConfig{
		ID: "zone-no-rules", Slug: "norules", OriginURL: "https://api.example.com", CacheTTL: 3600, Enabled: true,
	})

	registry := NewRedisRegistry(client)
	cfg, ok := registry.Resolve("norules.cdn.rivocloud.dev")
	if !ok {
		t.Fatal("expected zone to resolve")
	}
	if len(cfg.Rules) != 0 {
		t.Fatalf("expected no rules, got %+v", cfg.Rules)
	}
}
