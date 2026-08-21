package main

import (
	"log"
	"net/http"
	"os"

	"rivocloud/edge-proxy/internal/health"
)

func main() {
	port := os.Getenv("EDGE_PROXY_PORT")
	if port == "" {
		port = "8888"
	}
	log.Printf("edge-proxy listening on :%s", port)
	if err := http.ListenAndServe(":"+port, health.NewHandler()); err != nil {
		log.Fatal(err)
	}
}
