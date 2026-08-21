//go:build integration

package proxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func newTestRedisLayer(t *testing.T) cachestore.Layer {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("invalid REDIS_URL %q: %v", url, err)
	}
	client := redis.NewClient(opts)
	t.Cleanup(func() { client.FlushDB(context.Background()); client.Close() })
	return cachestore.NewRedis(client, fmt.Sprintf("edge-proxy-test:%d:", time.Now().UnixNano()))
}

func TestCachingHandler_WithRedis_SecondRequestIsHitFromRedis(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "max-age=3600")
		w.Header().Set("ETag", "v1")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("cacheable body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/asset", nil)
		r.Host = "demo.test"
		return r
	}

	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, req())
	if got := rec1.Header().Get("X-RivoCloud-Cache"); got != "MISS" {
		t.Fatalf("expected first request to be MISS, got %q", got)
	}

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req())
	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected second request to be HIT, got %q", got)
	}
	body, _ := io.ReadAll(rec2.Body)
	if string(body) != "cacheable body" {
		t.Fatalf("unexpected body on cache hit: %q", body)
	}
	if hits != 1 {
		t.Fatalf("expected origin to be hit exactly once, got %d", hits)
	}
}

func TestCachingHandler_WithRedis_NoStoreIsNeverCached(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "no-store")
		w.Write([]byte("never cache me"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/private", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req())
	h.ServeHTTP(httptest.NewRecorder(), req())

	if hits != 2 {
		t.Fatalf("expected origin to be hit on every request for no-store content, got %d", hits)
	}
}

func TestCachingHandler_WithRedis_ExpiredEntryRevalidatesWith304(t *testing.T) {
	requestCount := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if r.Header.Get("If-None-Match") == "v1" {
			w.Header().Set("Cache-Control", "max-age=3600")
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Cache-Control", "max-age=0")
		w.Header().Set("ETag", "v1")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("original body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{newTestRedisLayer(t)}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/revalidate-me", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req()) // first: stores with max-age=0 (always stale)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req()) // second: expired, revalidates, origin returns 304

	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected a 304-revalidated response to report HIT, got %q", got)
	}
	body, _ := io.ReadAll(rec2.Body)
	if string(body) != "original body" {
		t.Fatalf("expected the original cached body to be preserved across a 304, got %q", body)
	}
	if requestCount != 2 {
		t.Fatalf("expected exactly 2 origin requests (initial + revalidation), got %d", requestCount)
	}
}

type failingOriginFetcher struct{}

func (failingOriginFetcher) Do(req *http.Request) (*http.Response, error) {
	return nil, errors.New("connection refused")
}

func TestCachingHandler_WithRedis_ServesStaleOnOriginFailure(t *testing.T) {
	callCount := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Cache-Control", "max-age=0, stale-if-error=3600")
		w.Header().Set("ETag", "v1")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("stale-worthy body"))
	}))

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	redisLayer := newTestRedisLayer(t)
	h := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{redisLayer}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/resilient", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req()) // populate cache, then take the origin down
	origin.Close()

	h.Origin = failingOriginFetcher{}
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req())

	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "STALE" {
		t.Fatalf("expected STALE when origin is unreachable but a stale-if-error entry exists, got %q (status %d)", got, rec2.Code)
	}
	body, _ := io.ReadAll(rec2.Body)
	if string(body) != "stale-worthy body" {
		t.Fatalf("unexpected stale body: %q", body)
	}
	if callCount != 1 {
		t.Fatalf("expected exactly 1 successful origin call before it was closed, got %d", callCount)
	}
}
