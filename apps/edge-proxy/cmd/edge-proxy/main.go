package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"rivocloud/edge-proxy/internal/analytics"
	"rivocloud/edge-proxy/internal/cachestore"
	"rivocloud/edge-proxy/internal/configsync"
	"rivocloud/edge-proxy/internal/health"
	"rivocloud/edge-proxy/internal/invalidation"
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

	zones := zone.NewRedisRegistry(redisClient)
	configsync.Subscribe(natsURL(), zones)

	layers := []cachestore.Layer{
		memory,
		cachestore.NewRedis(redisClient, "edge-proxy:"),
	}
	invalidation.Subscribe(natsURL(), datacenter(), layers)

	analyticsPublisher, _ := analytics.Connect(natsURL())

	handler := &proxy.CachingHandler{
		Zones:          zones,
		Layers:         layers,
		Origin:         newOriginClient(),
		Analytics:      analyticsPublisher,
		Datacenter:     datacenter(),
		DefaultCountry: defaultCountry(),
	}

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.NewHandler())
	mux.Handle("/", handler)

	log.Printf("edge-proxy listening on :%s (zone config read from Redis, published by the CDN Service)", port)
	if err := newServer(port, mux).ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// newOriginClient is the edge's own origin-fetch client. http.DefaultClient
// has no timeout at all, so a hung origin would pin the request goroutine and
// its connection indefinitely.
func newOriginClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}

// newServer applies listener-side deadlines. http.ListenAndServe's implicit
// server has none, leaving the proxy open to slow-loris clients and to
// connections that never make progress.
func newServer(port string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

func natsURL() string {
	if u := os.Getenv("NATS_URL"); u != "" {
		return u
	}
	return "nats://localhost:4222"
}

func l1MaxEntries() int {
	if raw := os.Getenv("EDGE_PROXY_L1_MAX_ENTRIES"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			return n
		}
	}
	return 10_000
}

func datacenter() string {
	if dc := os.Getenv("EDGE_DATACENTER"); dc != "" {
		return dc
	}
	return "local"
}

func defaultCountry() string {
	if c := os.Getenv("EDGE_DEFAULT_COUNTRY"); c != "" {
		return c
	}
	return "ZZ"
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
