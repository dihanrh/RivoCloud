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
