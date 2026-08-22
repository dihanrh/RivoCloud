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
