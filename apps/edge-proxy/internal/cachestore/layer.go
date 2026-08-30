package cachestore

import "context"

// Layer is one level of the 3-layer cache (L1 in-process LRU or L2 Redis).
// The proxy handler checks layers fastest-to-slowest and populates faster
// layers on a slower-layer hit (EDD Section 2.1).
type Layer interface {
	Get(ctx context.Context, key string) (Entry, bool, error)
	Set(ctx context.Context, key string, entry Entry) error
	// Purge deletes every entry in this zone whose Path glob-matches any of
	// patterns, or whose Tags intersects tags, returning how many keys were
	// removed (EDD Section 4.4). An empty patterns and empty tags purges
	// nothing — callers must supply at least one, matching the CDN
	// Service's own validation that an invalidation needs a pattern or a
	// tag (apps/cdn-service/src/invalidations/invalidations.service.ts).
	Purge(ctx context.Context, zoneID string, patterns []string, tags []string) (int, error)
}
