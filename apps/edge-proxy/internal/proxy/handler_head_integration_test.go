//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

// NormalizeMethod folds HEAD onto GET's cache key, so a HEAD miss populates
// the entry a later GET will read. HTTP forbids a body on a HEAD response, so
// the origin request must be issued as GET or the shared entry is stored with
// an empty body and every later GET serves nothing with X-RivoCloud-Cache: HIT.
func TestCachingHandler_HeadMissDoesNotPoisonTheSharedGetEntry(t *testing.T) {
	var originMethods []string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		originMethods = append(originMethods, r.Method)
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("the real body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	memory, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memory}, Origin: http.DefaultClient}

	req := func(method string) *http.Request {
		r := httptest.NewRequest(method, "http://demo.test/shared", nil)
		r.Host = "demo.test"
		return r
	}

	headRec := httptest.NewRecorder()
	h.ServeHTTP(headRec, req("HEAD"))
	if headRec.Body.Len() != 0 {
		t.Fatalf("expected no body on a HEAD response, got %q", headRec.Body.String())
	}

	getRec := httptest.NewRecorder()
	h.ServeHTTP(getRec, req("GET"))
	if got := getRec.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected the GET to HIT the entry the HEAD populated, got %q", got)
	}
	if got := getRec.Body.String(); got != "the real body" {
		t.Fatalf("expected the GET after a HEAD to serve the real body, got %q", got)
	}
	if len(originMethods) != 1 || originMethods[0] != http.MethodGet {
		t.Fatalf("expected exactly one origin request, issued as GET, got %v", originMethods)
	}
}
