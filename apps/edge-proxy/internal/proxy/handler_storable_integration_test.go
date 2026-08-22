//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func newStorableTestHandler(t *testing.T, origin *httptest.Server) (*CachingHandler, cachestore.Layer) {
	t.Helper()
	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	memory, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	return &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: http.DefaultClient}, memory
}

// C4.1 — a 5xx is not in RFC 9111 §4.2.2's heuristically-cacheable set, so it
// must never be stored regardless of what its Cache-Control claims.
func TestCachingHandler_ServerErrorIsNeverCached(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("origin is on fire"))
	}))
	defer origin.Close()

	h, _ := newStorableTestHandler(t, origin)
	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/broken", nil)
		r.Host = "demo.test"
		return r
	}

	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, req())
	if rec1.Code != http.StatusInternalServerError {
		t.Fatalf("expected the 500 to be relayed, got %d", rec1.Code)
	}
	if got := rec1.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected a non-storable response to be advertised as no-store, got %q", got)
	}

	h.ServeHTTP(httptest.NewRecorder(), req())
	if hits != 2 {
		t.Fatalf("expected the origin to be hit on every request for an uncacheable 500, got %d", hits)
	}
}

func TestCachingHandler_UnlistedSuccessStatusIsNeverCached(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusAccepted) // 202: not heuristically cacheable
	}))
	defer origin.Close()

	h, _ := newStorableTestHandler(t, origin)
	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/accepted", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req())
	h.ServeHTTP(httptest.NewRecorder(), req())
	if hits != 2 {
		t.Fatalf("expected a 202 to never be cached, got %d origin hits", hits)
	}
}

// C4.2 — a Range request must bypass the cache in both directions: it must not
// read a full-body entry, and its 206 must not be stored under the full-body
// key.
func TestCachingHandler_RangeRequestBypassesTheCacheEntirely(t *testing.T) {
	var sawRange []string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawRange = append(sawRange, r.Header.Get("Range"))
		if rng := r.Header.Get("Range"); rng != "" {
			w.Header().Set("Content-Range", "bytes 0-3/20")
			w.Header().Set("Cache-Control", "public, max-age=3600")
			w.WriteHeader(http.StatusPartialContent)
			w.Write([]byte("PART"))
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("the whole body, all of it"))
	}))
	defer origin.Close()

	h, _ := newStorableTestHandler(t, origin)
	req := func(rng string) *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/video.mp4", nil)
		r.Host = "demo.test"
		if rng != "" {
			r.Header.Set("Range", rng)
		}
		return r
	}

	// A Range request first: it must reach the origin WITH the Range header
	// intact and must not populate the full-body cache entry.
	rangeRec := httptest.NewRecorder()
	h.ServeHTTP(rangeRec, req("bytes=0-3"))
	if rangeRec.Code != http.StatusPartialContent {
		t.Fatalf("expected the 206 to be relayed untouched, got %d", rangeRec.Code)
	}
	if got := rangeRec.Body.String(); got != "PART" {
		t.Fatalf("expected the partial body, got %q", got)
	}
	if got := rangeRec.Header().Get("X-RivoCloud-Cache"); got != "" {
		t.Fatalf("expected a Range request to bypass the cache pipeline entirely, got X-RivoCloud-Cache %q", got)
	}

	// Now a normal GET: it must go to the origin (the 206 must not have been
	// stored under this key) and get the full body.
	fullRec := httptest.NewRecorder()
	h.ServeHTTP(fullRec, req(""))
	if got := fullRec.Body.String(); got != "the whole body, all of it" {
		t.Fatalf("expected the full body (a 206 must never be stored under the full-body key), got %q", got)
	}

	// And a Range request must not be served the now-cached full entry.
	rangeRec2 := httptest.NewRecorder()
	h.ServeHTTP(rangeRec2, req("bytes=0-3"))
	if rangeRec2.Code != http.StatusPartialContent {
		t.Fatalf("expected the second Range request to still reach the origin, got %d", rangeRec2.Code)
	}
	if got := rangeRec2.Body.String(); got != "PART" {
		t.Fatalf("expected the partial body on the second Range request, got %q", got)
	}
	if len(sawRange) != 3 || sawRange[0] != "bytes=0-3" || sawRange[1] != "" || sawRange[2] != "bytes=0-3" {
		t.Fatalf("expected 3 origin requests with Range preserved as [bytes=0-3, <none>, bytes=0-3], got %q", sawRange)
	}
}

// I1 — a response to an Authorization-bearing request must not be stored and
// replayed to anonymous clients unless the origin marked it public.
func TestCachingHandler_AuthenticatedResponseIsNotCachedForAnonymousClients(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("alice's private dashboard"))
	}))
	defer origin.Close()

	h, _ := newStorableTestHandler(t, origin)

	authed := httptest.NewRequest("GET", "http://demo.test/dashboard", nil)
	authed.Host = "demo.test"
	authed.Header.Set("Authorization", "Bearer alice-token")
	authedRec := httptest.NewRecorder()
	h.ServeHTTP(authedRec, authed)
	if got := authedRec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected an authenticated response to be advertised no-store, got %q", got)
	}

	anon := httptest.NewRequest("GET", "http://demo.test/dashboard", nil)
	anon.Host = "demo.test"
	anonRec := httptest.NewRecorder()
	h.ServeHTTP(anonRec, anon)
	if got := anonRec.Header().Get("X-RivoCloud-Cache"); got == "HIT" {
		t.Fatal("expected an anonymous client to never be served an authenticated response from cache")
	}
	if hits != 2 {
		t.Fatalf("expected the origin to be hit for both requests, got %d", hits)
	}
}

func TestCachingHandler_ExplicitlyPublicAuthenticatedResponseIsStillCached(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("shared asset behind an auth wall"))
	}))
	defer origin.Close()

	h, _ := newStorableTestHandler(t, origin)
	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/public-asset", nil)
		r.Host = "demo.test"
		r.Header.Set("Authorization", "Bearer alice-token")
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req())
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req())
	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected an explicitly public response to stay cacheable, got %q", got)
	}
	if hits != 1 {
		t.Fatalf("expected exactly one origin hit, got %d", hits)
	}
}

// I2 — the origin's own Vary must survive to the client, and a Vary the edge
// cannot honor makes the response non-cacheable.
func TestCachingHandler_OriginVaryIsRelayedAndMakesResponseUncacheable(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Vary", "Cookie")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("varies by cookie"))
	}))
	defer origin.Close()

	h, _ := newStorableTestHandler(t, origin)
	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/personalized", nil)
		r.Host = "demo.test"
		return r
	}

	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, req())
	if got := rec1.Header().Get("Vary"); got != "Cookie" {
		t.Fatalf("expected the origin's own Vary to be relayed intact, got %q", got)
	}

	h.ServeHTTP(httptest.NewRecorder(), req())
	if hits != 2 {
		t.Fatalf("expected a Vary the edge cannot honor to make the response uncacheable, got %d origin hits", hits)
	}
}

func TestCachingHandler_AcceptEncodingOnlyVaryStillGetsTheEdgesOwnVary(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html>plain</html>"))
	}))
	defer origin.Close()

	h, _ := newStorableTestHandler(t, origin)
	req := httptest.NewRequest("GET", "http://demo.test/plain.html", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("expected the edge to still set Vary: Accept-Encoding when the origin sent none, got %q", got)
	}
}
