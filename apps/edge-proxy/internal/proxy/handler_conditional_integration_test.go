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

// Browsers send If-None-Match routinely. Against a cold edge the client's own
// conditional must never reach the origin: the edge has nothing cached to
// revalidate, so a 304 would leave it with a zero-valued Entry to "refresh"
// and serve (WriteHeader(0) panics).
func TestCachingHandler_DoesNotForwardClientConditionalHeadersToOrigin(t *testing.T) {
	var sawConditional []string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, h := range []string{"If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "If-Range"} {
			if v := r.Header.Get(h); v != "" {
				sawConditional = append(sawConditional, h+": "+v)
			}
		}
		if r.Header.Get("If-None-Match") == "\"client-etag\"" {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("real body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	memory, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/cold", nil)
	req.Host = "demo.test"
	req.Header.Set("If-None-Match", "\"client-etag\"")
	req.Header.Set("If-Modified-Since", "Thu, 01 Jan 2026 00:00:00 GMT")
	req.Header.Set("If-Match", "\"other\"")
	req.Header.Set("If-Unmodified-Since", "Thu, 01 Jan 2026 00:00:00 GMT")
	req.Header.Set("If-Range", "\"other\"")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req) // pre-fix: panics with "invalid WriteHeader code 0"

	if len(sawConditional) != 0 {
		t.Fatalf("expected the client's own conditional headers to be stripped before reaching the origin, origin saw: %v", sawConditional)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected a cold-cache request to be served 200 from the origin, got %d", rec.Code)
	}
	if got := rec.Body.String(); got != "real body" {
		t.Fatalf("expected the origin's real body, got %q", got)
	}
}

// Defence in depth for the same class of bug: even if a 304 somehow arrives
// with nothing cached to refresh, the handler must not build a response out of
// a zero-valued Entry.
func TestCachingHandler_Origin304WithNothingCachedIsNotServedAsAZeroEntry(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	memory, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/unconditional", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req) // pre-fix: panics with "invalid WriteHeader code 0"

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 for an unsolicited origin 304 with nothing cached, got %d", rec.Code)
	}
}

// The notModified branch stored unconditionally, ignoring decision.Cacheable —
// a revalidation whose 304 says "no-store" must not be written back to the
// cache. Observable through the stored entry's StoredAt: pre-fix the second
// request rewrites it to the (advanced) clock, post-fix it stays untouched.
func TestCachingHandler_NotModifiedWithNoStoreIsNotStored(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") == "v1" {
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Cache-Control", "max-age=0")
		w.Header().Set("ETag", "v1")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	memory, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	h := &CachingHandler{
		Zones:  zones,
		Layers: []cachestore.Layer{memory},
		Origin: http.DefaultClient,
		Now:    func() time.Time { return clock },
	}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/revalidate-nostore", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req()) // stores with max-age=0 (immediately stale)
	firstStore := clock
	clock = clock.Add(time.Hour)
	h.ServeHTTP(httptest.NewRecorder(), req()) // revalidates; the 304 says no-store

	key := cachekey.Build("z1", "GET", "demo.test", "/revalidate-nostore", "", "include_all", nil)
	entry, ok, err := memory.Get(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected the first request's entry to still be present")
	}
	if !entry.StoredAt.Equal(firstStore) {
		t.Fatalf("expected a no-store 304 to leave the cache untouched, but StoredAt moved from %s to %s", firstStore, entry.StoredAt)
	}
}
