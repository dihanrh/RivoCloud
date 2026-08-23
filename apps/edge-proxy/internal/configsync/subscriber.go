package configsync

import (
	"encoding/json"
	"log"

	"github.com/nats-io/nats.go"
)

// ZoneEvicter is satisfied by *zone.RedisRegistry — kept as a narrow
// interface here so this package doesn't need to import zone just to call
// one method.
type ZoneEvicter interface {
	EvictZone(zoneID string)
}

type configUpdate struct {
	ZoneID string `json:"zoneId"`
}

// Subscribe listens for the CDN Service's config.zones.updated notifications
// (docs/concepts/cdn-zones-and-configuration.md Section 4) and evicts that
// zone from the registry's in-process cache so the next request re-reads
// Redis instead of waiting out the up-to-60s TTL. Best-effort: a NATS outage
// only logs, since the 60s TTL is already the guaranteed fallback.
func Subscribe(natsURL string, registry ZoneEvicter) {
	nc, err := nats.Connect(natsURL)
	if err != nil {
		log.Printf("configsync: NATS unavailable, relying on the 60s config TTL: %v", err)
		return
	}
	if _, err := nc.Subscribe("config.zones.updated", func(msg *nats.Msg) {
		var update configUpdate
		if err := json.Unmarshal(msg.Data, &update); err != nil {
			log.Printf("configsync: bad config.zones.updated payload: %v", err)
			return
		}
		registry.EvictZone(update.ZoneID)
	}); err != nil {
		log.Printf("configsync: subscribe failed, relying on the 60s config TTL: %v", err)
	}
}
