package main

import (
	"log"
	"net/http"
	"os"
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

	zones := zone.NewStaticRegistry([]zone.Config{
		{
			ID:         "demo",
			Host:       "localhost",
			OriginURL:  demoOriginURL(),
			DefaultTTL: time.Hour,
		},
	})

	handler := &proxy.CachingHandler{
		Zones:  zones,
		Layers: []cachestore.Layer{cachestore.NewRedis(redisClient, "edge-proxy:")},
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
