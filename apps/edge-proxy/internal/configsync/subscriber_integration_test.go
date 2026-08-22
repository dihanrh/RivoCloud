//go:build integration

package configsync

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
)

type fakeEvicter struct {
	evicted chan string
}

func (f *fakeEvicter) EvictZone(zoneID string) {
	f.evicted <- zoneID
}

func natsURL() string {
	if u := os.Getenv("NATS_URL"); u != "" {
		return u
	}
	return "nats://localhost:4222"
}

func TestSubscribe_EvictsOnConfigZonesUpdated(t *testing.T) {
	evicter := &fakeEvicter{evicted: make(chan string, 1)}
	Subscribe(natsURL(), evicter)

	nc, err := nats.Connect(natsURL())
	if err != nil {
		t.Fatalf("failed to connect a publisher: %v", err)
	}
	defer nc.Close()

	payload, _ := json.Marshal(map[string]string{"zoneId": "zone-42"})
	if err := nc.Publish("config.zones.updated", payload); err != nil {
		t.Fatalf("publish failed: %v", err)
	}

	select {
	case zoneID := <-evicter.evicted:
		if zoneID != "zone-42" {
			t.Fatalf("expected zone-42, got %s", zoneID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the subscriber to evict zone-42")
	}
}
