//go:build integration

package proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/zone"
)

func TestCachingHandler_NoLayers_ForwardsRequestAndRelaysResponseUntouched(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hello" {
			t.Fatalf("expected origin to receive /hello, got %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello from origin"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/hello", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if string(body) != "hello from origin" {
		t.Fatalf("expected body from origin, got %q", body)
	}
	if got := rec.Header().Get("X-RivoCloud-Cache"); got != "MISS" {
		t.Fatalf("expected X-RivoCloud-Cache: MISS with no cache layers, got %q", got)
	}
}

func TestCachingHandler_UnknownZoneReturns404(t *testing.T) {
	zones := zone.NewStaticRegistry(nil)
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://unknown.test/anything", nil)
	req.Host = "unknown.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown zone, got %d", rec.Code)
	}
}

func TestCachingHandler_NonGetMethodIsProxiedUncached(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected origin to receive POST, got %s", r.Method)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("POST", "http://demo.test/submit", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 relayed from origin, got %d", rec.Code)
	}
}

func TestCachingHandler_StripsSetCookieFromCachedEntry(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Set-Cookie", "session=super-secret-value; HttpOnly")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/page", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("expected Set-Cookie to never be relayed through the cache pipeline, got %q", got)
	}
}
