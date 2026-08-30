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

func TestRedis_PurgeByPathPattern(t *testing.T) {
	r := newTestRedisLayer(t)
	ctx := context.Background()
	future := time.Now().Add(time.Hour)
	_ = r.Set(ctx, "key-a", Entry{ZoneID: "z1", Path: "/assets/app.js", StaleUntil: future})
	_ = r.Set(ctx, "key-b", Entry{ZoneID: "z1", Path: "/index.html", StaleUntil: future})
	_ = r.Set(ctx, "key-c", Entry{ZoneID: "z2", Path: "/assets/app.js", StaleUntil: future})

	count, err := r.Purge(ctx, "z1", []string{"/assets/*"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 key purged, got %d", count)
	}
	if _, ok, _ := r.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged")
	}
	if _, ok, _ := r.Get(ctx, "key-b"); !ok {
		t.Fatal("expected key-b (different path) to remain")
	}
	if _, ok, _ := r.Get(ctx, "key-c"); !ok {
		t.Fatal("expected key-c (different zone) to remain")
	}
}

func TestRedis_PurgeByTag(t *testing.T) {
	r := newTestRedisLayer(t)
	ctx := context.Background()
	future := time.Now().Add(time.Hour)
	_ = r.Set(ctx, "tag-key-a", Entry{ZoneID: "z1", Path: "/posts/1", Tags: []string{"blog-post-123"}, StaleUntil: future})
	_ = r.Set(ctx, "tag-key-b", Entry{ZoneID: "z1", Path: "/other", Tags: []string{"unrelated"}, StaleUntil: future})

	count, err := r.Purge(ctx, "z1", nil, []string{"blog-post-123"})
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 key purged, got %d", count)
	}
	if _, ok, _ := r.Get(ctx, "tag-key-b"); !ok {
		t.Fatal("expected tag-key-b (no matching tag) to remain")
	}
}
