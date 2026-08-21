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
