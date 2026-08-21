//go:build integration

package proxy

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func TestCachingHandler_DoesNotForwardClientAcceptEncodingToOrigin(t *testing.T) {
	// NOTE: this deliberately does NOT assert on the raw Accept-Encoding
	// header the origin receives. Empirically (see the fix report), Go's
	// http.Transport always writes its own "Accept-Encoding: gzip" on the
	// wire whenever the outgoing *http.Request has no such header at all
	// (net/http/transport.go's requestedGzip logic) — so the origin sees
	// "gzip" both when the client's header is forwarded verbatim (the bug)
	// and when it's correctly deleted (the fix, letting Transport manage
	// it). That header is therefore not a reliable signal either way.
	//
	// The real, observable symptom of the bug is double-compression: a
	// real gzip-aware origin that honors the (buggy, forwarded) header
	// returns an actually-gzipped body with Content-Encoding: gzip set,
	// which the buggy code never decompresses before caching/compressing
	// it again. So this test simulates such an origin directly and checks
	// the client only ever sees a single layer of gzip.
	plainBody := []byte("<html>no double compression</html>")
	var gzippedByOrigin bytes.Buffer
	gw := gzip.NewWriter(&gzippedByOrigin)
	if _, err := gw.Write(plainBody); err != nil {
		t.Fatal(err)
	}
	if err := gw.Close(); err != nil {
		t.Fatal(err)
	}

	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.Header().Set("Content-Encoding", "gzip")
		w.WriteHeader(http.StatusOK)
		w.Write(gzippedByOrigin.Bytes())
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/page.html", nil)
	req.Host = "demo.test"
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	gr, err := gzip.NewReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("expected exactly one layer of gzip compression, got invalid gzip: %v", err)
	}
	defer gr.Close()
	decompressed, err := io.ReadAll(gr)
	if err != nil {
		t.Fatalf("expected decompressible body: %v", err)
	}
	if string(decompressed) != string(plainBody) {
		t.Fatalf("unexpected decompressed body (possible double-compression): %q", decompressed)
	}
}

func TestCachingHandler_StaleResponseIsGzipNegotiated(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "max-age=0, stale-if-error=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html>stale but compressible</html>"))
	}))

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/resilient.html", nil)
		r.Host = "demo.test"
		r.Header.Set("Accept-Encoding", "gzip")
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req()) // populate cache, then take the origin down
	origin.Close()

	h.Origin = failingOriginFetcher{}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req())

	if got := rec.Header().Get("X-RivoCloud-Cache"); got != "STALE" {
		t.Fatalf("expected STALE, got %q", got)
	}
	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("expected a stale response to still honor Accept-Encoding: gzip, got Content-Encoding %q", got)
	}
}

func TestCachingHandler_ServesGzipVariantWhenAccepted(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html>compressible</html>"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/page.html", nil)
	req.Host = "demo.test"
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("expected Content-Encoding: gzip, got %q", got)
	}
	gr, err := gzip.NewReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("expected body to be valid gzip: %v", err)
	}
	defer gr.Close()
	decompressed, _ := io.ReadAll(gr)
	if string(decompressed) != "<html>compressible</html>" {
		t.Fatalf("unexpected decompressed body: %q", decompressed)
	}
}

func TestCachingHandler_ServesIdentityWhenGzipNotAccepted(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("<html>compressible</html>"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/page.html", nil)
	req.Host = "demo.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("expected no Content-Encoding without Accept-Encoding: gzip, got %q", got)
	}
	body, _ := io.ReadAll(rec.Body)
	if string(body) != "<html>compressible</html>" {
		t.Fatalf("unexpected body: %q", body)
	}
}

func TestCachingHandler_NeverCompressesBinaryContent(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("\x89PNGnotreallyapngbutclosenough"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/photo.png", nil)
	req.Host = "demo.test"
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("expected image content to never be gzip-compressed, got Content-Encoding %q", got)
	}
}
