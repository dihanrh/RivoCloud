package cachestore

import (
	"context"
	"testing"
)

func TestMemory_SetThenGetReturnsSameEntry(t *testing.T) {
	m, err := NewMemory(10)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	want := Entry{StatusCode: 200, Body: []byte("hello")}

	if err := m.Set(ctx, "key1", want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := m.Get(ctx, "key1")
	if err != nil || !ok {
		t.Fatalf("expected hit, got ok=%v err=%v", ok, err)
	}
	if string(got.Body) != "hello" {
		t.Fatalf("expected body 'hello', got %q", got.Body)
	}
}

func TestMemory_GetMissReturnsFalse(t *testing.T) {
	m, err := NewMemory(10)
	if err != nil {
		t.Fatal(err)
	}
	_, ok, err := m.Get(context.Background(), "missing")
	if err != nil || ok {
		t.Fatalf("expected miss, got ok=%v err=%v", ok, err)
	}
}

func TestMemory_EvictsLeastRecentlyUsedWhenFull(t *testing.T) {
	m, err := NewMemory(1)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	_ = m.Set(ctx, "first", Entry{Body: []byte("1")})
	_ = m.Set(ctx, "second", Entry{Body: []byte("2")})

	_, ok, _ := m.Get(ctx, "first")
	if ok {
		t.Fatal("expected 'first' to have been evicted once capacity was exceeded")
	}
	_, ok, _ = m.Get(ctx, "second")
	if !ok {
		t.Fatal("expected 'second' to still be present")
	}
}

func TestMemory_PurgeByPathPattern(t *testing.T) {
	m, _ := NewMemory(10)
	ctx := context.Background()
	_ = m.Set(ctx, "key-a", Entry{ZoneID: "z1", Path: "/assets/app.js", Body: []byte("a")})
	_ = m.Set(ctx, "key-b", Entry{ZoneID: "z1", Path: "/index.html", Body: []byte("b")})
	_ = m.Set(ctx, "key-c", Entry{ZoneID: "z2", Path: "/assets/app.js", Body: []byte("c")})

	count, err := m.Purge(ctx, "z1", []string{"/assets/*"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 key purged, got %d", count)
	}
	if _, ok, _ := m.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged")
	}
	if _, ok, _ := m.Get(ctx, "key-b"); !ok {
		t.Fatal("expected key-b (different path) to remain")
	}
	if _, ok, _ := m.Get(ctx, "key-c"); !ok {
		t.Fatal("expected key-c (different zone) to remain")
	}
}

func TestMemory_PurgeByTag(t *testing.T) {
	m, _ := NewMemory(10)
	ctx := context.Background()
	_ = m.Set(ctx, "key-a", Entry{ZoneID: "z1", Path: "/posts/1", Tags: []string{"blog-post-123"}})
	_ = m.Set(ctx, "key-b", Entry{ZoneID: "z1", Path: "/feed.xml", Tags: []string{"blog-post-123", "feed"}})
	_ = m.Set(ctx, "key-c", Entry{ZoneID: "z1", Path: "/other", Tags: []string{"unrelated"}})

	count, err := m.Purge(ctx, "z1", nil, []string{"blog-post-123"})
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected 2 keys purged, got %d", count)
	}
	if _, ok, _ := m.Get(ctx, "key-c"); !ok {
		t.Fatal("expected key-c (no matching tag) to remain")
	}
}

func TestMemory_PurgeWithNoPatternsOrTagsPurgesNothing(t *testing.T) {
	m, _ := NewMemory(10)
	ctx := context.Background()
	_ = m.Set(ctx, "key-a", Entry{ZoneID: "z1", Path: "/a"})

	count, err := m.Purge(ctx, "z1", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected 0 keys purged when no patterns/tags given, got %d", count)
	}
}
