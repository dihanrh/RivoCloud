package health

import (
	"encoding/json"
	"net/http"
)

// NewHandler returns the Edge Proxy's liveness endpoint. It is deliberately
// its own tiny package so cmd/edge-proxy/main.go stays a thin wiring layer.
func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	return mux
}
