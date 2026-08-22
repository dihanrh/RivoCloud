package cachestore

import (
	"testing"
	"time"
)

func TestEntry_FreshBeforeExpiry(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e := Entry{ExpiresAt: now.Add(time.Minute)}
	if !e.Fresh(now) {
		t.Fatal("expected entry to be fresh before its ExpiresAt")
	}
}

func TestEntry_NotFreshAfterExpiry(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e := Entry{ExpiresAt: now.Add(-time.Second)}
	if e.Fresh(now) {
		t.Fatal("expected entry to not be fresh after its ExpiresAt")
	}
}

func TestEntry_UsableAsStaleWithinWindow(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e := Entry{ExpiresAt: now.Add(-time.Hour), StaleUntil: now.Add(time.Hour)}
	if !e.UsableAsStale(now) {
		t.Fatal("expected entry to be usable as stale within its window")
	}
}

func TestEntry_NotUsableAsStalePastWindow(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	e := Entry{StaleUntil: now.Add(-time.Second)}
	if e.UsableAsStale(now) {
		t.Fatal("expected entry to not be usable as stale past its window")
	}
}
