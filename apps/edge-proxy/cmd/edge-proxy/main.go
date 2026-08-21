package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"rivocloud/edge-proxy/internal/health"
	"rivocloud/edge-proxy/internal/proxy"
	"rivocloud/edge-proxy/internal/zone"
)

func main() {
	port := os.Getenv("EDGE_PROXY_PORT")
	if port == "" {
		port = "8888"
	}

	// Stage 3 hardcodes zone configuration on purpose (EDD Section 2.1,
	// concept doc Section 6) — the CDN Service (Stage 4) replaces this with
	// a database-and-Redis-backed registry.
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
