package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/health"
	"rivocloud/edge-proxy/internal/proxy"
	"rivocloud/edge-proxy/internal/zone"
)

func main() {
	port := os.Getenv("EDGE_PROXY_PORT")
	if port == "" {
		port = "8888"
	}

	redisClient := mustConnectRedis()
	memory, err := cachestore.NewMemory(l1MaxEntries())
	if err != nil {
		log.Fatalf("failed to create L1 cache: %v", err)
	}

	zones := zone.NewStaticRegistry([]zone.Config{
		{
			ID:         "demo",
			Host:       "localhost",
			OriginURL:  demoOriginURL(),
			DefaultTTL: time.Hour,
		},
	})

	handler := &proxy.CachingHandler{
		Zones: zones,
		Layers: []cachestore.Layer{
			memory,
			cachestore.NewRedis(redisClient, "edge-proxy:"),
		},
		Origin: http.DefaultClient,
	}

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.NewHandler())
	mux.Handle("/", handler)

	log.Printf("edge-proxy listening on :%s (demo zone origin: %s)", port, demoOriginURL())
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func demoOriginURL() string {
	if u := os.Getenv("EDGE_PROXY_DEMO_ORIGIN_URL"); u != "" {
		return u
	}
	return "http://localhost:9999"
}

func l1MaxEntries() int {
	if raw := os.Getenv("EDGE_PROXY_L1_MAX_ENTRIES"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return n
		}
	}
	return 10_000
}

func mustConnectRedis() *redis.Client {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379"
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		log.Fatalf("invalid REDIS_URL %q: %v", url, err)
	}
	return redis.NewClient(opts)
}
