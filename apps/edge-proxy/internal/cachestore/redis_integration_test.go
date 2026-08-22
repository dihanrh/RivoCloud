//go:build integration

package cachestore

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func newTestRedisLayer(t *testing.T) *Redis {
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
	return NewRedis(client, "edge-proxy-test:")
}

func TestRedis_SetThenGetReturnsSameEntry(t *testing.T) {
	r := newTestRedisLayer(t)
	ctx := context.Background()
	now := time.Now()
	want := Entry{
		StatusCode: 200,
		Body:       []byte("hello from redis"),
		ETag:       "abc123",
		Cacheable:  true,
		StoredAt:   now,
		ExpiresAt:  now.Add(time.Minute),
		StaleUntil: now.Add(time.Hour),
	}

	if err := r.Set(ctx, "redis-key1", want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := r.Get(ctx, "redis-key1")
	if err != nil || !ok {
		t.Fatalf("expected hit, got ok=%v err=%v", ok, err)
	}
	if string(got.Body) != "hello from redis" || got.ETag != "abc123" {
		t.Fatalf("unexpected entry: %+v", got)
	}
}

func TestRedis_GetMissReturnsFalse(t *testing.T) {
	r := newTestRedisLayer(t)
	_, ok, err := r.Get(context.Background(), "does-not-exist")
	if err != nil || ok {
		t.Fatalf("expected miss, got ok=%v err=%v", ok, err)
	}
}

func TestRedis_EntryPastStaleUntilIsNotStored(t *testing.T) {
	r := newTestRedisLayer(t)
	ctx := context.Background()
	past := Entry{Body: []byte("too old"), StaleUntil: time.Now().Add(-time.Hour)}

	if err := r.Set(ctx, "redis-key-expired", past); err != nil {
		t.Fatal(err)
	}
	_, ok, err := r.Get(ctx, "redis-key-expired")
	if err != nil || ok {
		t.Fatalf("expected an already-stale entry to not be stored, got ok=%v err=%v", ok, err)
	}
}
