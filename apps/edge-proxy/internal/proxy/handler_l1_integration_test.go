//go:build integration

package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/zone"
)

func TestCachingHandler_WithL1AndL2_ThirdRequestHitsL1WithoutRedis(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("layered body"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	redisLayer := newTestRedisLayer(t)
	memory, err := cachestore.NewMemory(100)
	if err != nil {
		t.Fatal(err)
	}
	h := &CachingHandler{
		Zones:  zones,
		Layers: []cachestore.Layer{memory, redisLayer},
		Origin: http.DefaultClient,
	}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/hot-asset", nil)
		r.Host = "demo.test"
		return r
	}

	h.ServeHTTP(httptest.NewRecorder(), req()) // MISS: fetched from origin, stored in L1+L2
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req()) // HIT from L1 (populated by the first request)
	if got := rec2.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected second request to HIT, got %q", got)
	}

	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req())
	if got := rec3.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected third request to HIT from L1, got %q", got)
	}
	if hits != 1 {
		t.Fatalf("expected origin to be hit exactly once across all three requests, got %d", hits)
	}
}

func TestCachingHandler_WithL1AndL2_DifferentHandlerInstanceMissesL1ButHitsL2(t *testing.T) {
	hits := 0
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Cache-Control", "max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("shared across replicas"))
	}))
	defer origin.Close()

	zones := zone.NewStaticRegistry([]zone.Config{{ID: "z1", Host: "demo.test", OriginURL: origin.URL}})
	sharedRedis := newTestRedisLayer(t)

	memoryA, _ := cachestore.NewMemory(100)
	replicaA := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memoryA, sharedRedis}, Origin: http.DefaultClient}

	memoryB, _ := cachestore.NewMemory(100)
	replicaB := &CachingHandler{Zones: zones, Layers: []cachestore.Layer{memoryB, sharedRedis}, Origin: http.DefaultClient}

	req := func() *http.Request {
		r := httptest.NewRequest("GET", "http://demo.test/pop-shared-asset", nil)
		r.Host = "demo.test"
		return r
	}

	replicaA.ServeHTTP(httptest.NewRecorder(), req()) // replica A: MISS, populates its L1 + shared L2

	recB := httptest.NewRecorder()
	replicaB.ServeHTTP(recB, req()) // replica B: L1 miss (its own, empty), but L2 hit
	if got := recB.Header().Get("X-RivoCloud-Cache"); got != "HIT" {
		t.Fatalf("expected replica B to HIT via the shared L2, got %q", got)
	}
	if hits != 1 {
		t.Fatalf("expected origin to be hit exactly once across both replicas, got %d", hits)
	}
}
