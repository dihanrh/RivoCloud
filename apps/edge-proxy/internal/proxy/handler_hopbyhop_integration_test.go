//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/zone"
)

// Hop-by-hop headers are scoped to a single connection and must not cross a
// proxy boundary (RFC 7230 §6.1) — including whatever extra field names the
// client's own Connection header nominates.
func TestCachingHandler_StripsHopByHopHeadersBeforeReachingOrigin(t *testing.T) {
	var leaked []string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, name := range []string{
			"Connection", "Keep-Alive", "Proxy-Authorization", "Te", "Trailer",
			"Transfer-Encoding", "Upgrade", "X-Hop-Scoped-Token",
		} {
			if v := r.Header.Get(name); v != "" {
				leaked = append(leaked, name+": "+v)
			}
		}
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/asset", nil)
	req.Host = "demo.test"
	// "Connection" nominates X-Hop-Scoped-Token as hop-scoped too.
	req.Header.Set("Connection", "keep-alive, X-Hop-Scoped-Token")
	req.Header.Set("X-Hop-Scoped-Token", "must-not-cross-the-proxy")
	req.Header.Set("Keep-Alive", "timeout=5")
	req.Header.Set("Proxy-Authorization", "Basic ZGVhZDpiZWVm")
	req.Header.Set("Te", "trailers")
	req.Header.Set("Trailer", "Expires")
	req.Header.Set("Upgrade", "websocket")

	h.ServeHTTP(httptest.NewRecorder(), req)

	if len(leaked) != 0 {
		t.Fatalf("expected all hop-by-hop headers to be stripped before the origin request, origin saw: %v", leaked)
	}
}

func TestCachingHandler_SetsXForwardedForFromClientAddress(t *testing.T) {
	var sawXFF string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawXFF = r.Header.Get("X-Forwarded-For")
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/a", nil)
	req.Host = "demo.test"
	req.RemoteAddr = "198.51.100.23:54321"
	h.ServeHTTP(httptest.NewRecorder(), req)

	if sawXFF != "198.51.100.23" {
		t.Fatalf("expected X-Forwarded-For to carry the client IP, got %q", sawXFF)
	}
}

func TestCachingHandler_AppendsToExistingXForwardedFor(t *testing.T) {
	var sawXFF string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawXFF = r.Header.Get("X-Forwarded-For")
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/b", nil)
	req.Host = "demo.test"
	req.RemoteAddr = "198.51.100.23:54321"
	req.Header.Set("X-Forwarded-For", "203.0.113.7")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if sawXFF != "203.0.113.7, 198.51.100.23" {
		t.Fatalf("expected the client IP to be appended to the existing X-Forwarded-For chain, got %q", sawXFF)
	}
}

func TestCachingHandler_XForwardedForHandlesIPv6RemoteAddr(t *testing.T) {
	var sawXFF string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawXFF = r.Header.Get("X-Forwarded-For")
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Origin: http.DefaultClient}

	req := httptest.NewRequest("GET", "http://demo.test/c", nil)
	req.Host = "demo.test"
	req.RemoteAddr = "[2001:db8::1]:54321"
	h.ServeHTTP(httptest.NewRecorder(), req)

	if sawXFF != "2001:db8::1" {
		t.Fatalf("expected the IPv6 literal without its port or brackets, got %q", sawXFF)
	}
}
