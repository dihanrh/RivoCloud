//go:build integration

package proxy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"rivocloud/edge-proxy/internal/cachekey"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func entryWith(body string, storedAt, expiresAt, staleUntil time.Time) cachestore.Entry {
	return cachestore.Entry{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"text/plain"}},
		Body:       []byte(body),
		Cacheable:  true,
		StoredAt:   storedAt,
		ExpiresAt:  expiresAt,
		StaleUntil: staleUntil,
	}
}

// lookup returned the FIRST layer holding the key at all, even when that copy
// was expired — so in a multi-replica deployment every replica whose L1 held a
// stale copy re-hit the origin instead of taking L2's already-fresh one,
// defeating the point of a shared L2.
func TestCachingHandler_FreshL2IsPreferredOverStaleL1(t *testing.T) {
	originHits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		originHits++
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("from origin"))
	}))
	defer origin.Close()

	// Anchored to real time on purpose: cachestore.Redis derives its key TTL
	// from time.Until(entry.StaleUntil) against the real clock, so a fake
	// clock set in the past would make every L2 write a silent no-op.
	now := time.Now()
	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	l1, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	l2 := newTestRedisLayer(t)
	h := &CachingHandler{
		Zones:  zones,
		Layers: []cachestore.Layer{l1, l2},
		Origin: http.DefaultClient,
		Now:    func() time.Time { return now },
	}

	key := cachekey.Build("z1", "GET", "demo.test", "/shared", "", "include_all", nil)
	ctx := context.Background()
	// L1 holds an expired copy; the shared L2 holds a fresh one.
	if err := l1.Set(ctx, key, entryWith("stale from L1", now.Add(-2*time.Hour), now.Add(-time.Minute), now.Add(time.Hour))); err != nil {
		t.Fatal(err)
	}
	if err := l2.Set(ctx, key, entryWith("fresh from L2", now, now.Add(time.Hour), now.Add(2*time.Hour))); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "http://demo.test/shared", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected a HIT from the fresh L2 copy, got %q", got)
	}
	if got := rec.Body.String(); got != "fresh from L2" {
		t.Fatalf("expected L2's fresh body, got %q", got)
	}
	if originHits != 0 {
		t.Fatalf("expected the origin to be untouched when a slower layer holds a fresh copy, got %d hits", originHits)
	}

	// And the fresh copy should have back-filled L1, replacing the stale one.
	promoted, ok, err := l1.Get(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || string(promoted.Body) != "fresh from L2" {
		t.Fatalf("expected L1 to be back-filled with L2's fresh copy, got ok=%v body=%q", ok, promoted.Body)
	}
}

// When every layer's copy is stale, the stale-if-error fallback must still
// have something to serve — the scan must not lose the stale candidates it
// passed over while looking for a fresh one.
func TestCachingHandler_AllLayersStaleStillServesStaleOnOriginFailure(t *testing.T) {
	now := time.Now() // see the note in the test above
	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: "http://127.0.0.1:1"}})
	l1, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	l2 := newTestRedisLayer(t)
	h := &CachingHandler{
		Zones:  zones,
		Layers: []cachestore.Layer{l1, l2},
		Origin: failingOriginFetcher{},
		Now:    func() time.Time { return now },
	}

	key := cachekey.Build("z1", "GET", "demo.test", "/all-stale", "", "include_all", nil)
	ctx := context.Background()
	// L1's copy expired an hour ago, L2's only a minute ago: the fresher of
	// the two stale candidates should win.
	if err := l1.Set(ctx, key, entryWith("older stale", now.Add(-3*time.Hour), now.Add(-time.Hour), now.Add(time.Hour))); err != nil {
		t.Fatal(err)
	}
	if err := l2.Set(ctx, key, entryWith("newer stale", now.Add(-time.Hour), now.Add(-time.Minute), now.Add(time.Hour))); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "http://demo.test/all-stale", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-RivoCloud-Cache"); got != "STALE" {
		t.Fatalf("expected STALE when every layer is stale and the origin is down, got %q (status %d)", got, rec.Code)
	}
	if got := rec.Body.String(); got != "newer stale" {
		t.Fatalf("expected the most-recently-expired stale candidate, got %q", got)
	}
}
