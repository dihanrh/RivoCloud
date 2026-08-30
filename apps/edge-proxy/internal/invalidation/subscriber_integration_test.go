//go:build integration

package invalidation

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/nats-io/nats.go"

	"rivocloud/edge-proxy/internal/cachestore"
)

func natsURL() string {
	if u := os.Getenv("NATS_URL"); u != "" {
		return u
	}
	return "nats://localhost:4222"
}

func TestSubscribe_PurgesLayersAndReplies(t *testing.T) {
	memory, _ := cachestore.NewMemory(10)
	ctx := context.Background()
	_ = memory.Set(ctx, "key-a", cachestore.Entry{ZoneID: "zone-inv-1", Path: "/assets/app.js"})
	_ = memory.Set(ctx, "key-b", cachestore.Entry{ZoneID: "zone-inv-1", Path: "/index.html"})

	Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})

	nc, err := nats.Connect(natsURL())
	if err != nil {
		t.Fatalf("failed to connect a requester: %v", err)
	}
	defer nc.Close()

	payload, _ := json.Marshal(map[string]any{
		"zoneId":         "zone-inv-1",
		"patterns":       []string{"/assets/*"},
		"tags":           []string{},
		"invalidationId": "inv-1",
	})
	msg, err := nc.Request("cache.invalidate.zone-inv-1", payload, 2*time.Second)
	if err != nil {
		t.Fatalf("expected a reply, got error: %v", err)
	}

	var reply struct {
		Datacenter string `json:"datacenter"`
		KeysPurged int    `json:"keysPurged"`
		DurationMs int64  `json:"durationMs"`
	}
	if err := json.Unmarshal(msg.Data, &reply); err != nil {
		t.Fatalf("bad reply JSON: %v", err)
	}
	if reply.Datacenter != "test-dc" || reply.KeysPurged != 1 {
		t.Fatalf("unexpected reply: %+v", reply)
	}

	if _, ok, _ := memory.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged")
	}
	if _, ok, _ := memory.Get(ctx, "key-b"); !ok {
		t.Fatal("expected key-b (different path) to remain")
	}
}

func TestSubscribe_WildcardSubjectMatchesAnyZone(t *testing.T) {
	memory, _ := cachestore.NewMemory(10)
	ctx := context.Background()
	_ = memory.Set(ctx, "key-a", cachestore.Entry{ZoneID: "zone-inv-2", Path: "/logo.png"})

	Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})

	nc, err := nats.Connect(natsURL())
	if err != nil {
		t.Fatalf("failed to connect a requester: %v", err)
	}
	defer nc.Close()

	payload, _ := json.Marshal(map[string]any{"zoneId": "zone-inv-2", "patterns": []string{"/logo.png"}})
	if _, err := nc.Request("cache.invalidate.zone-inv-2", payload, 2*time.Second); err != nil {
		t.Fatalf("expected a reply from the wildcard subscription, got: %v", err)
	}
	if _, ok, _ := memory.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged")
	}
}

// TestSubscribe_MixedCasePatternMatchesLowercaseStoredPath verifies the
// case-folding addition made after Task 10: Entry.Path is always stored
// lowercase, but an invalidation pattern arrives over NATS exactly as a
// customer typed it (possibly mixed case). Without lowercasing the pattern
// before Purge, a mixed-case pattern would silently fail to match anything.
//
// Like TestSubscribe_WildcardSubjectMatchesAnyZone, this checks the actual
// purge side effect on this test's own layer rather than the reply body's
// keysPurged count: every earlier test in this file also leaves its own
// wildcard subscription (cache.invalidate.*) running for the rest of the
// process, so a later request can legitimately race against a still-live
// subscription with a different zoneID/layer and have that stale, unrelated
// reply (correctly reporting 0 for its own layer) win the request. That
// race is a property of Subscribe() never closing its NATS connection
// across independent Subscribe calls in one test binary — orthogonal to
// this test's actual purpose — so the assertion here is on the layer this
// test controls, not on which of several replies happened to arrive first.
func TestSubscribe_MixedCasePatternMatchesLowercaseStoredPath(t *testing.T) {
	memory, _ := cachestore.NewMemory(10)
	ctx := context.Background()
	_ = memory.Set(ctx, "key-a", cachestore.Entry{ZoneID: "zone-inv-3", Path: "/assets/app.js"})

	Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})

	nc, err := nats.Connect(natsURL())
	if err != nil {
		t.Fatalf("failed to connect a requester: %v", err)
	}
	defer nc.Close()

	payload, _ := json.Marshal(map[string]any{
		"zoneId":   "zone-inv-3",
		"patterns": []string{"/Assets/*"},
	})
	if _, err := nc.Request("cache.invalidate.zone-inv-3", payload, 2*time.Second); err != nil {
		t.Fatalf("expected a reply, got error: %v", err)
	}

	if _, ok, _ := memory.Get(ctx, "key-a"); ok {
		t.Fatal("expected key-a to have been purged despite the mixed-case pattern")
	}
}
