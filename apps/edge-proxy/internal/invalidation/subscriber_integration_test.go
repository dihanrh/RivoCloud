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

	sub, err := Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})
	if err != nil {
		t.Fatalf("failed to subscribe: %v", err)
	}
	t.Cleanup(func() { _ = sub.Unsubscribe() })

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

	sub, err := Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})
	if err != nil {
		t.Fatalf("failed to subscribe: %v", err)
	}
	t.Cleanup(func() { _ = sub.Unsubscribe() })

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

// TestSubscribe_SubjectZoneIDMismatchIsIgnored verifies the defense-in-depth
// check added to handle(): a message published on cache.invalidate.zone-a
// but whose JSON body claims a different zoneId (zone-b) must not purge
// anything for either zone, and must not reply. This guards a shared NATS
// bus where any publisher could otherwise purge an arbitrary zone by
// crafting a mismatched payload.
func TestSubscribe_SubjectZoneIDMismatchIsIgnored(t *testing.T) {
	memory, _ := cachestore.NewMemory(10)
	ctx := context.Background()
	_ = memory.Set(ctx, "key-a", cachestore.Entry{ZoneID: "zone-a", Path: "/logo.png"})
	_ = memory.Set(ctx, "key-b", cachestore.Entry{ZoneID: "zone-b", Path: "/logo.png"})

	sub, err := Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})
	if err != nil {
		t.Fatalf("failed to subscribe: %v", err)
	}
	t.Cleanup(func() { _ = sub.Unsubscribe() })

	nc, err := nats.Connect(natsURL())
	if err != nil {
		t.Fatalf("failed to connect a requester: %v", err)
	}
	defer nc.Close()

	// Published on zone-a's subject, but the payload claims zone-b.
	payload, _ := json.Marshal(map[string]any{
		"zoneId":   "zone-b",
		"patterns": []string{"/logo.png"},
	})
	if _, err := nc.Request("cache.invalidate.zone-a", payload, 1*time.Second); err == nil {
		t.Fatal("expected no reply for a subject/payload zoneId mismatch, but got one")
	}

	if _, ok, _ := memory.Get(ctx, "key-a"); !ok {
		t.Fatal("expected key-a (zone-a) to remain, since the payload's own zoneId was zone-b")
	}
	if _, ok, _ := memory.Get(ctx, "key-b"); !ok {
		t.Fatal("expected key-b (zone-b) to remain, since nothing arrived on zone-b's subject")
	}
}

// TestSubscribe_MixedCasePatternMatchesLowercaseStoredPath verifies the
// case-folding addition made after Task 10: Entry.Path is always stored
// lowercase, but an invalidation pattern arrives over NATS exactly as a
// customer typed it (possibly mixed case). Without lowercasing the pattern
// before Purge, a mixed-case pattern would silently fail to match anything.
func TestSubscribe_MixedCasePatternMatchesLowercaseStoredPath(t *testing.T) {
	memory, _ := cachestore.NewMemory(10)
	ctx := context.Background()
	_ = memory.Set(ctx, "key-a", cachestore.Entry{ZoneID: "zone-inv-3", Path: "/assets/app.js"})

	sub, err := Subscribe(natsURL(), "test-dc", []cachestore.Layer{memory})
	if err != nil {
		t.Fatalf("failed to subscribe: %v", err)
	}
	t.Cleanup(func() { _ = sub.Unsubscribe() })

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
