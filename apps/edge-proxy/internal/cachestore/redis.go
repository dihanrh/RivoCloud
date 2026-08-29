package cachestore

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis is the L2 cache: shared by every Edge Proxy replica in a PoP
// (EDD Section 2.1).
type Redis struct {
	client *redis.Client
	prefix string
}

func NewRedis(client *redis.Client, prefix string) *Redis {
	return &Redis{client: client, prefix: prefix}
}

func (r *Redis) Get(ctx context.Context, key string) (Entry, bool, error) {
	raw, err := r.client.Get(ctx, r.prefix+key).Bytes()
	if errors.Is(err, redis.Nil) {
		return Entry{}, false, nil
	}
	if err != nil {
		return Entry{}, false, err
	}
	var e Entry
	if err := json.Unmarshal(raw, &e); err != nil {
		return Entry{}, false, err
	}
	return e, true, nil
}

func (r *Redis) Set(ctx context.Context, key string, entry Entry) error {
	ttl := time.Until(entry.StaleUntil)
	if ttl <= 0 {
		return nil // already past its stale-if-error deadline; not worth storing
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, r.prefix+key, raw, ttl).Err()
}

// Purge implements the EDD's Section 4.4 flow literally: "SCAN Redis for
// matching keys → delete." There is no secondary path/tag index — this
// service's own keys (prefix-scoped) are enumerated, each fetched and
// filtered by ZoneID/Path/Tags, and matches deleted. SCAN is safe to run
// against a live Redis (non-blocking, cursor-based), and at Phase 1's
// single-PoP scale the total key count this walks is small.
func (r *Redis) Purge(ctx context.Context, zoneID string, patterns []string, tags []string) (int, error) {
	if len(patterns) == 0 && len(tags) == 0 {
		return 0, nil
	}
	purged := 0
	var cursor uint64
	for {
		keys, next, err := r.client.Scan(ctx, cursor, r.prefix+"*", 200).Result()
		if err != nil {
			return purged, err
		}
		for _, redisKey := range keys {
			raw, err := r.client.Get(ctx, redisKey).Bytes()
			if errors.Is(err, redis.Nil) {
				continue // deleted between SCAN and GET; nothing to purge
			}
			if err != nil {
				return purged, err
			}
			var entry Entry
			if err := json.Unmarshal(raw, &entry); err != nil {
				continue
			}
			if entry.ZoneID != zoneID {
				continue
			}
			if matchesAny(entry, patterns, tags) {
				if err := r.client.Del(ctx, redisKey).Err(); err != nil {
					return purged, err
				}
				purged++
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return purged, nil
}
