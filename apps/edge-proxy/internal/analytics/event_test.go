package analytics

import (
	"encoding/json"
	"testing"
	"time"
)

func TestEvent_MarshalsExpectedJSONFieldNames(t *testing.T) {
	event := Event{
		Timestamp: time.Date(2026, 6, 29, 10, 0, 0, 0, time.UTC), ZoneID: "zone_abc123",
		OrgID: "org_xyz789", Datacenter: "Nuremberg-HZ-1", Method: "GET", Path: "/assets/main.js",
		StatusCode: 200, CacheStatus: "HIT", BytesSent: 45231, DurationMs: 12,
		Country: "DE", ClientIPHash: "sha256hash",
	}

	raw, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	for _, field := range []string{
		"timestamp", "zone_id", "org_id", "datacenter", "method", "path",
		"status_code", "cache_status", "bytes_sent", "duration_ms", "country", "client_ip_hash",
	} {
		if _, ok := decoded[field]; !ok {
			t.Errorf("expected JSON field %q, got keys %v", field, decoded)
		}
	}
	if decoded["zone_id"] != "zone_abc123" {
		t.Errorf("unexpected zone_id: %v", decoded["zone_id"])
	}
}
