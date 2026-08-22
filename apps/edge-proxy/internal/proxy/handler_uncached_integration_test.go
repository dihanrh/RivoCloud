//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/zone"
)

// fetchOrigin returns response: nil when the origin replies 304, so
// proxyUncached's unconditional `defer result.response.Body.Close()` panicked
// on any non-GET/HEAD (or, since C4, Range) request whose origin 304s.
func TestProxyUncached_Origin304DoesNotNilDeref(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("POST", "http://demo.test/submit", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req) // pre-fix: nil pointer dereference

	if rec.Code != http.StatusNotModified {
		t.Fatalf("expected a bare 304 to be relayed to the client, got %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("expected no body on a 304, got %q", rec.Body.String())
	}
}

func TestProxyUncached_RangeRequestWithOrigin304DoesNotNilDeref(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/video.mp4", nil)
	req.Host = "demo.test"
	req.Header.Set("Range", "bytes=0-3")
	req.Header.Set("If-Range", "\"v1\"")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotModified {
		t.Fatalf("expected a bare 304 to be relayed to the client, got %d", rec.Code)
	}
}

// The uncached passthrough proxies the client's preconditions as part of the
// semantics it is relaying — stripping If-Match off a PUT would silently
// break optimistic concurrency at the origin.
func TestProxyUncached_PreservesClientPreconditions(t *testing.T) {
	var sawIfMatch string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawIfMatch = r.Header.Get("If-Match")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("PUT", "http://demo.test/doc", nil)
	req.Host = "demo.test"
	req.Header.Set("If-Match", "\"rev-7\"")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if sawIfMatch != "\"rev-7\"" {
		t.Fatalf("expected If-Match to reach the origin on an uncached PUT, got %q", sawIfMatch)
	}
}
