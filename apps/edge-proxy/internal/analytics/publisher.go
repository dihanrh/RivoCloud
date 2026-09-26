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

// Connect dials NATS at startup and keeps the connection alive for the
// process's lifetime: RetryOnFailedConnect means a NATS that isn't reachable
// yet at boot no longer leaves the proxy permanently disconnected — the
// client keeps retrying in the background — and MaxReconnects(-1) means a
// later outage is retried forever instead of giving up after the client's
// default finite attempt count. While (re)connecting, Publish calls land in
// the client's bounded reconnect buffer and are flushed once connected (or
// dropped once that buffer is full) — never blocking the hot path.
//
// Because of RetryOnFailedConnect, an unreachable server is NOT an error
// here: Connect returns a usable *Publisher and a nil error, and the
// connection is established asynchronously. A non-nil error now only means
// the client could not be constructed at all (e.g. a malformed NATS URL). It
// always returns a non-nil *Publisher (even on error) so callers can wire it
// into CachingHandler unconditionally — Publish is a no-op when no client
// exists.
func Connect(natsURL string) (*Publisher, error) {
	nc, err := nats.Connect(natsURL,
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ConnectHandler(func(*nats.Conn) {
			log.Printf("analytics: NATS connected, request events are being published")
		}),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			log.Printf("analytics: NATS disconnected, request events are buffered until reconnect: %v", err)
		}),
		nats.ReconnectHandler(func(*nats.Conn) {
			log.Printf("analytics: NATS reconnected, request event publishing resumed")
		}),
	)
	if err != nil {
		log.Printf("analytics: NATS client could not be created, request events will not be published: %v", err)
		return &Publisher{}, err
	}
	if !nc.IsConnected() {
		log.Printf("analytics: NATS not reachable yet at %s, retrying in the background", natsURL)
	}
	return &Publisher{nc: nc}, nil
}

// Publish is safe to call on a nil *Publisher or one whose client could not
// be created — it silently no-ops in both cases.
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
