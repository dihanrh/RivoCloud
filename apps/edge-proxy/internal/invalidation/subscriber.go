// Package invalidation subscribes the Edge Proxy to the CDN Service's
// cache.invalidate.{zoneId} NATS events (EDD Section 4.4) and purges
// matching entries from every configured cache layer, replying with how
// many keys it purged so the CDN Service can aggregate across every Edge
// Proxy (concept doc Section 2.4's scatter-gather pattern).
package invalidation

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"github.com/nats-io/nats.go"

	"rivocloud/edge-proxy/internal/cachestore"
)

type invalidateEvent struct {
	ZoneID         string   `json:"zoneId"`
	Patterns       []string `json:"patterns"`
	Tags           []string `json:"tags"`
	InvalidationID string   `json:"invalidationId"`
}

type invalidateReply struct {
	Datacenter string `json:"datacenter"`
	KeysPurged int    `json:"keysPurged"`
	DurationMs int64  `json:"durationMs"`
}

// Subscribe listens for invalidation events on every zone (a wildcard
// subscription, matching the concept doc Section 2.4: "every Edge Proxy
// subscribes with a wildcard cache.invalidate.* so it hears invalidations
// for all zones it might be caching content for"). Best-effort: if NATS is
// unavailable at startup, this only logs — invalidation degrades to "wait
// for the TTL to expire," never a hard failure of the proxy itself.
//
// The returned *nats.Subscription is nil on any error; production callers
// (main.go) can discard it. Integration tests that call Subscribe more than
// once in the same process MUST call sub.Unsubscribe() in cleanup — a
// leaked subscription keeps matching cache.invalidate.* for the rest of the
// process and will race a later test's own request for the reply.
func Subscribe(natsURL, datacenter string, layers []cachestore.Layer) (*nats.Subscription, error) {
	nc, err := nats.Connect(natsURL)
	if err != nil {
		log.Printf("invalidation: NATS unavailable, invalidation will not be delivered: %v", err)
		return nil, err
	}
	sub, err := nc.Subscribe("cache.invalidate.*", func(msg *nats.Msg) {
		handle(msg, datacenter, layers)
	})
	if err != nil {
		log.Printf("invalidation: subscribe failed: %v", err)
		return nil, err
	}
	return sub, nil
}

func handle(msg *nats.Msg, datacenter string, layers []cachestore.Layer) {
	start := time.Now()
	var event invalidateEvent
	if err := json.Unmarshal(msg.Data, &event); err != nil {
		log.Printf("invalidation: bad cache.invalidate payload: %v", err)
		return
	}

	if expectedSubject := "cache.invalidate." + event.ZoneID; msg.Subject != expectedSubject {
		log.Printf("invalidation: payload zoneId %q does not match subject %q, ignoring", event.ZoneID, msg.Subject)
		return
	}

	// Entry.Path is always stored lowercase (cachestore normalizes it at
	// write time — see Task 10), but a pattern arrives here exactly as a
	// customer typed it via the CDN Service's public API and may be mixed
	// case. cachestore's glob matching is case-sensitive, so a mixed-case
	// pattern would silently match nothing unless we lowercase it here.
	// Tags are compared for exact equality against arbitrary user-defined
	// strings, not glob-matched against a normalized path, so they are left
	// as-is.
	for i, pattern := range event.Patterns {
		event.Patterns[i] = strings.ToLower(pattern)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	total := 0
	for i, layer := range layers {
		if layer == nil {
			continue
		}
		count, err := layer.Purge(ctx, event.ZoneID, event.Patterns, event.Tags)
		total += count
		if err != nil {
			log.Printf("invalidation: layer %d purge error for zone %s: %v", i, event.ZoneID, err)
		}
	}

	if msg.Reply == "" {
		return
	}
	reply, err := json.Marshal(invalidateReply{Datacenter: datacenter, KeysPurged: total, DurationMs: time.Since(start).Milliseconds()})
	if err != nil {
		log.Printf("invalidation: failed to marshal reply: %v", err)
		return
	}
	if err := msg.Respond(reply); err != nil {
		log.Printf("invalidation: failed to send reply: %v", err)
	}
}
