package analytics

import (
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
)

// EventPublisher is satisfied by *Publisher; tests inject a fake that
// records published events instead of dialing real NATS.
type EventPublisher interface {
	Publish(Event)
}

// Publisher publishes edge.request events to NATS, fire-and-forget — the
// same "NATS unavailable degrades, never blocks the hot path" convention as
// the invalidation and configsync packages.
type Publisher struct {
	nc *nats.Conn
}

// Connect dials NATS once at startup. It always returns a non-nil *Publisher
// (even on error) so callers can wire it into CachingHandler unconditionally
// — Publish becomes a no-op until a connection exists.
func Connect(natsURL string) (*Publisher, error) {
	nc, err := nats.Connect(natsURL)
	if err != nil {
		log.Printf("analytics: NATS unavailable, request events will not be published: %v", err)
		return &Publisher{}, err
	}
	return &Publisher{nc: nc}, nil
}

// Publish is safe to call on a nil *Publisher or one whose connection never
// succeeded — it silently no-ops in both cases.
func (p *Publisher) Publish(event Event) {
	if p == nil || p.nc == nil {
		return
	}
	payload, err := json.Marshal(event)
	if err != nil {
		log.Printf("analytics: failed to marshal edge.request event: %v", err)
		return
	}
	if err := p.nc.Publish("edge.request", payload); err != nil {
		log.Printf("analytics: publish failed: %v", err)
	}
}
