package cachestore

import "context"

// Layer is one level of the 3-layer cache (L1 in-process LRU or L2 Redis).
// The proxy handler checks layers fastest-to-slowest and populates faster
// layers on a slower-layer hit (EDD Section 2.1).
type Layer interface {
	Get(ctx context.Context, key string) (Entry, bool, error)
	Set(ctx context.Context, key string, entry Entry) error
}
