// Package analytics publishes one JSON event per Edge Proxy request to NATS
// subject "edge.request" (EDD Section 2.5), for the Analytics Service to
// batch-insert into ClickHouse.
package analytics

import "time"

// Event mirrors the EDD Section 2.5 edge.request payload exactly — these
// JSON field names are a cross-service contract with the NestJS Analytics
// Service and must not change without updating both sides.
type Event struct {
	Timestamp    time.Time `json:"timestamp"`
	ZoneID       string    `json:"zone_id"`
	OrgID        string    `json:"org_id"`
	Datacenter   string    `json:"datacenter"`
	Method       string    `json:"method"`
	Path         string    `json:"path"`
	StatusCode   int       `json:"status_code"`
	CacheStatus  string    `json:"cache_status"`
	BytesSent    int64     `json:"bytes_sent"`
	DurationMs   int64     `json:"duration_ms"`
	Country      string    `json:"country"`
	ClientIPHash string    `json:"client_ip_hash"`
}
