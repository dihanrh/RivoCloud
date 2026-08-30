//go:build integration

package proxy

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"rivocloud/edge-proxy/internal/cachekey"
	"rivocloud/edge-proxy/internal/cacherules"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

// countingOrigin is a fake OriginFetcher that always returns the same
// canned status/body/headers and counts how many times it was called — used
// here to assert that a bypass rule hits the origin on every request, unlike
// the httptest.NewServer fakes used elsewhere in this package which don't
// expose a call count as conveniently.
type countingOrigin struct {
	status  int
	body    []byte
	headers http.Header
	calls   int
}

func (o *countingOrigin) Do(req *http.Request) (*http.Response, error) {
	o.calls++
	header := make(http.Header)
	for k, vs := range o.headers {
		for _, v := range vs {
			header.Add(k, v)
		}
	}
	return &http.Response{
		StatusCode: o.status,
		Header:     header,
		Body:       io.NopCloser(bytes.NewReader(o.body)),
	}, nil
}

func TestHandler_BypassRuleNeverCaches(t *testing.T) {
	origin := &countingOrigin{status: http.StatusOK, body: []byte("dynamic"), headers: http.Header{"Cache-Control": {"max-age=3600"}}}
	edgeTTLZero := 0
	zones := zone.NewStaticRegistry([]zone.Config{{
		ID: "z1", Host: "cdn.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour,
		Rules: []cacherules.Rule{{Pattern: "/api/*", PatternType: "glob", Action: "bypass", EdgeTTL: &edgeTTLZero, Priority: 10}},
	}})
	memory, _ := cachestore.NewMemory(10)
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: origin}

	req := httptest.NewRequest(http.MethodGet, "http://cdn.test/api/users", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://cdn.test/api/users", nil))

	if origin.calls != 2 {
		t.Fatalf("expected a bypass rule to hit the origin every time, got %d calls", origin.calls)
	}
}

func TestHandler_CacheRuleOverridesOriginTTL(t *testing.T) {
	origin := &countingOrigin{status: http.StatusOK, body: []byte("asset"), headers: http.Header{"Cache-Control": {"max-age=5"}}}
	longTTL := 604800
	zones := zone.NewStaticRegistry([]zone.Config{{
		ID: "z1", Host: "cdn.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour,
		Rules: []cacherules.Rule{{Pattern: "/assets/*", PatternType: "glob", Action: "cache", EdgeTTL: &longTTL, Priority: 1}},
	}})
	memory, _ := cachestore.NewMemory(10)
	now := time.Now()
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: origin, Now: func() time.Time { return now }}

	req := httptest.NewRequest(http.MethodGet, "http://cdn.test/assets/app.js", nil)
	h.ServeHTTP(httptest.NewRecorder(), req)

	key := cachekey.Build("z1", "GET", "cdn.test", "/assets/app.js", "", "strip_all", nil)
	entry, ok, err := memory.Get(req.Context(), key)
	if err != nil || !ok {
		t.Fatalf("expected an entry stored under the rule's query mode, got ok=%v err=%v", ok, err)
	}
	if entry.ExpiresAt.Sub(now) < 604800*time.Second-time.Second {
		t.Fatalf("expected the rule's 604800s edgeTtl to override the origin's max-age=5, got expiry in %s", entry.ExpiresAt.Sub(now))
	}
}

func TestHandler_BypassRuleMatchesPathCaseInsensitively(t *testing.T) {
	origin := &countingOrigin{status: http.StatusOK, body: []byte("dynamic"), headers: http.Header{"Cache-Control": {"max-age=3600"}}}
	zones := zone.NewStaticRegistry([]zone.Config{{
		ID: "z1", Host: "cdn.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour,
		Rules: []cacherules.Rule{{Pattern: "/api/*", PatternType: "glob", Action: "bypass", Priority: 10}},
	}})
	memory, _ := cachestore.NewMemory(10)
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: origin}

	req := httptest.NewRequest(http.MethodGet, "http://cdn.test/API/users", nil)
	h.ServeHTTP(httptest.NewRecorder(), req)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "http://cdn.test/API/users", nil))

	if origin.calls != 2 {
		t.Fatalf("expected a bypass rule for /api/* to match /API/users case-insensitively and hit the origin every time, got %d calls", origin.calls)
	}

	// Belt-and-suspenders: cachekey.Build itself lowercases the path, so a
	// bug here wouldn't just skip the bypass rule — it would also cache the
	// mixed-case request's dynamic response under the SAME key a lowercase
	// "/api/users" request would use.
	key := cachekey.Build("z1", "GET", "cdn.test", "/API/users", "", "include_all", nil)
	if _, ok, _ := memory.Get(req.Context(), key); ok {
		t.Fatal("expected the mixed-case bypassed path to never be cached")
	}
}

func TestHandler_EntryPathIsStoredLowercasedMatchingCacheKeyNormalization(t *testing.T) {
	origin := &countingOrigin{status: http.StatusOK, body: []byte("post"), headers: http.Header{"Cache-Control": {"max-age=3600"}}}
	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "cdn.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour}})
	memory, _ := cachestore.NewMemory(10)
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: origin}

	req := httptest.NewRequest(http.MethodGet, "http://cdn.test/Posts/1", nil)
	h.ServeHTTP(httptest.NewRecorder(), req)

	// cachekey.Build lowercases the path internally, so the entry must be
	// findable under the LOWERCASED key even though the request path itself
	// was mixed-case.
	key := cachekey.Build("z1", "GET", "cdn.test", "/Posts/1", "", "include_all", nil)
	entry, ok, _ := memory.Get(req.Context(), key)
	if !ok {
		t.Fatal("expected an entry to be stored under the cache key's own lowercased normalization")
	}
	if entry.Path != "/posts/1" {
		t.Fatalf("expected Entry.Path to be lowercased to match the cache key's normalization (so a future purge glob-matches the same bytes), got %q", entry.Path)
	}
}

func TestHandler_PopulatesZoneIDAndPathAndTagsFromCacheTagHeader(t *testing.T) {
	origin := &countingOrigin{status: http.StatusOK, body: []byte("post"), headers: http.Header{
		"Cache-Control": {"max-age=3600"},
		"Cache-Tag":     {"blog-post-123, feed"},
	}}
	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "cdn.test", OriginURL: "http://origin.test", DefaultTTL: time.Hour}})
	memory, _ := cachestore.NewMemory(10)
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: origin}

	req := httptest.NewRequest(http.MethodGet, "http://cdn.test/posts/1", nil)
	h.ServeHTTP(httptest.NewRecorder(), req)

	key := cachekey.Build("z1", "GET", "cdn.test", "/posts/1", "", "include_all", nil)
	entry, ok, _ := memory.Get(req.Context(), key)
	if !ok {
		t.Fatal("expected an entry to be stored")
	}
	if entry.ZoneID != "z1" || entry.Path != "/posts/1" {
		t.Fatalf("expected ZoneID/Path to be populated, got %+v", entry)
	}
	if len(entry.Tags) != 2 || entry.Tags[0] != "blog-post-123" || entry.Tags[1] != "feed" {
		t.Fatalf("expected Tags parsed from Cache-Tag header, got %+v", entry.Tags)
	}
}
